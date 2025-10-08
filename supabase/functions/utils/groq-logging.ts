// Groq-specific model call logging utilities
import { logModelCall, extractThinking, estimateTokenCount } from './model-logging.ts';
import Groq from 'https://esm.sh/groq-sdk@0.7.0';

/**
 * A wrapper function for Groq reasoning model API calls with automatic logging
 * Supports GPT-OSS (20B, 120B) and Qwen 3 32B models with full reasoning capabilities
 * 
 * @param functionName The name of the calling function
 * @param prompt The prompt to send to the model
 * @param apiKey The Groq API key
 * @param domain Optional domain context
 * @param metadata Optional additional metadata (can include reasoningEffort, reasoningFormat, includeReasoning, tools, temperature, etc.)
 * @returns The model's response with reasoning extracted
 */
export async function callGroqWithLogging(
  functionName: string,
  prompt: string,
  apiKey: string,
  domain?: string,
  metadata: Record<string, any> = {}
): Promise<{ response: string, reasoning: string | null }> {
  try {
    const modelName = metadata.modelName || 'openai/gpt-oss-120b';
    console.log(`[${functionName}] Calling Groq reasoning model API with ${modelName}...`);
    
    // Detect model type for reasoning parameter handling
    const isGPTOSS = modelName.includes('gpt-oss');
    const isQwen = modelName.includes('qwen');
    
    // Extract target URL for logging if it exists in metadata
    let targetUrl = 'https://api.groq.com/openai/v1/chat/completions'; // Default to Groq API URL
    if (metadata.url) {
      targetUrl = metadata.url; // Use the target URL from metadata if available
      console.log(`[${functionName}] Using target URL for logging: ${targetUrl}`);
    } else if (metadata.pageUrl) {
      targetUrl = metadata.pageUrl; // Alternative field name
      console.log(`[${functionName}] Using page URL for logging: ${targetUrl}`);
    }
    
    const requestStart = Date.now();
    
    // Initialize Groq client
    const groq = new Groq({
      apiKey: apiKey,
    });
    
    // Collect the full response from streaming
    let fullResponse = '';
    let reasoning = '';
    
    // Build the completion options
    const completionOptions: any = {
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      model: modelName,
      temperature: metadata.temperature ?? 0.6, // Use recommended 0.6 default
      max_completion_tokens: metadata.maxTokens || 65536,
      top_p: metadata.topP ?? 0.95, // Use recommended 0.95 default
      stream: true,
      stop: metadata.stop || null,
    };
    
    // Handle reasoning parameters based on model type and mutual exclusivity rules
    if (metadata.includeReasoning !== undefined && metadata.reasoningFormat !== undefined) {
      throw new Error('include_reasoning and reasoning_format parameters are mutually exclusive');
    }
    
    if (isGPTOSS) {
      // GPT-OSS models: Use include_reasoning parameter (not reasoning_format)
      // reasoning_effort options: "low", "medium", "high"
      completionOptions.reasoning_effort = metadata.reasoningEffort || 'high';
      
      if (metadata.includeReasoning !== undefined) {
        completionOptions.include_reasoning = metadata.includeReasoning;
      } else {
        // Default to including reasoning for GPT-OSS models
        completionOptions.include_reasoning = true;
      }
      
      console.log(`[${functionName}] GPT-OSS model config - reasoning_effort: ${completionOptions.reasoning_effort}, include_reasoning: ${completionOptions.include_reasoning}`);
    } else if (isQwen) {
      // Qwen 3 32B: Uses reasoning_format parameter and different reasoning_effort options
      // reasoning_effort options: "none", "default"
      completionOptions.reasoning_effort = metadata.reasoningEffort || 'default';
      
      if (metadata.reasoningFormat) {
        completionOptions.reasoning_format = metadata.reasoningFormat;
      } else {
        // Default to 'parsed' for better separation of reasoning
        completionOptions.reasoning_format = 'parsed';
      }
      
      console.log(`[${functionName}] Qwen model config - reasoning_effort: ${completionOptions.reasoning_effort}, reasoning_format: ${completionOptions.reasoning_format}`);
    } else {
      // Unknown model - don't add reasoning parameters unless explicitly specified
      // K2 and other models don't support reasoning_effort
      console.warn(`[${functionName}] Unknown model type: ${modelName}, skipping reasoning parameters`);
      
      // Only add reasoning parameters if explicitly provided in metadata
      if (metadata.reasoningEffort !== undefined) {
        // Only add if the caller explicitly wants it (they know their model supports it)
        completionOptions.reasoning_effort = metadata.reasoningEffort;
      }
      
      if (metadata.includeReasoning !== undefined) {
        completionOptions.include_reasoning = metadata.includeReasoning;
      }
    }
    
    // Add tools if specified
    if (metadata.tools) {
      completionOptions.tools = metadata.tools;
    } else if (metadata.useBrowserSearch) {
      completionOptions.tools = [{ type: 'browser_search' }];
    } else if (metadata.useCodeInterpreter) {
      completionOptions.tools = [{ type: 'code_interpreter' }];
    }
    
    // Create the chat completion with streaming
    console.log(`[${functionName}] Creating chat completion with model: ${modelName}`);
    console.log(`[${functionName}] Reasoning config: effort=${completionOptions.reasoning_effort}, format=${completionOptions.reasoning_format || 'N/A'}, include=${completionOptions.include_reasoning || 'N/A'}`);
    
    const chatCompletion = await groq.chat.completions.create(completionOptions);
    
    // Process the stream and collect the response
    for await (const chunk of chatCompletion) {
      // Handle reasoning content (GPT-OSS models with include_reasoning=true)
      // GPT-OSS returns reasoning in delta.reasoning field, not delta.reasoning_content
      if (chunk.choices[0]?.delta?.reasoning) {
        reasoning += chunk.choices[0].delta.reasoning;
      }
      
      // Handle regular content
      const content = chunk.choices[0]?.delta?.content || '';
      fullResponse += content;
      
      // Also check for tool calls if tools are enabled
      if (chunk.choices[0]?.delta?.tool_calls) {
        console.log(`[${functionName}] Tool calls detected in response`);
      }
    }
    
    const requestDuration = Date.now() - requestStart;
    console.log(`[${functionName}] Request completed in ${requestDuration}ms`);
    
    // Handle reasoning extraction based on model type and settings
    if (isQwen && completionOptions.reasoning_format === 'raw') {
      // For Qwen with raw format, reasoning is in <think> tags within the content
      const extracted = extractThinking(fullResponse);
      fullResponse = extracted.response;
      reasoning = extracted.thinking;
      console.log(`[${functionName}] Extracted reasoning from <think> tags (${reasoning.length} chars)`);
    } else if (isQwen && completionOptions.reasoning_format === 'parsed') {
      // For Qwen with parsed format, reasoning should be in dedicated field
      // If not found in stream, check final response structure
      if (!reasoning && fullResponse) {
        // Try to find reasoning in response structure
        try {
          const responseObj = JSON.parse(fullResponse);
          if (responseObj.reasoning) {
            reasoning = responseObj.reasoning;
            fullResponse = responseObj.content || responseObj.response || fullResponse;
          }
        } catch (e) {
          // Not JSON, continue with normal extraction
        }
      }
    } else if (isQwen && completionOptions.reasoning_format === 'hidden') {
      // Hidden format - no reasoning expected
      reasoning = '';
      console.log(`[${functionName}] Reasoning hidden by format setting`);
    } else if (isGPTOSS && completionOptions.include_reasoning === false) {
      // GPT-OSS with reasoning disabled
      reasoning = '';
      console.log(`[${functionName}] Reasoning disabled by include_reasoning=false`);
    }
    
    // Fallback: If no dedicated reasoning field found and we expect reasoning, try to extract from response
    if (!reasoning && (
        (isGPTOSS && completionOptions.include_reasoning !== false) ||
        (isQwen && completionOptions.reasoning_format !== 'hidden' && completionOptions.reasoning_effort !== 'none')
      )) {
      const extracted = extractThinking(fullResponse);
      fullResponse = extracted.response;
      reasoning = extracted.thinking;
      console.log(`[${functionName}] Fallback reasoning extraction (${reasoning.length} chars)`);
    }
    
    // Calculate token counts
    const promptTokens = estimateTokenCount(prompt);
    const responseTokens = estimateTokenCount(fullResponse);
    const reasoningTokens = estimateTokenCount(reasoning);
    const totalTokens = promptTokens + responseTokens + reasoningTokens;
    
    console.log(`[${functionName}] Token usage - Prompt: ${promptTokens}, Response: ${responseTokens}, Reasoning: ${reasoningTokens}, Total: ${totalTokens}`);
    
    // Log the successful call
    await logModelCall(
      functionName,
      targetUrl,
      prompt,
      fullResponse,
      reasoning,
      domain,
      { 
        ...metadata, 
        duration_ms: requestDuration,
        prompt_tokens: promptTokens,
        response_tokens: responseTokens,
        reasoning_tokens: reasoningTokens,
        total_tokens: totalTokens,
        model: modelName,
        provider: 'groq',
        model_type: isGPTOSS ? 'gpt-oss' : isQwen ? 'qwen' : 'unknown',
        reasoning_effort: completionOptions.reasoning_effort,
        reasoning_format: completionOptions.reasoning_format || null,
        include_reasoning: completionOptions.include_reasoning || null,
        tools_used: metadata.tools || (metadata.useBrowserSearch ? [{ type: 'browser_search' }] : metadata.useCodeInterpreter ? [{ type: 'code_interpreter' }] : [])
      },
      'success'
    );
    
    return { response: fullResponse, reasoning };
  } catch (error) {
    const modelName = metadata.modelName || 'openai/gpt-oss-120b';
    const isGPTOSS = modelName.includes('gpt-oss');
    const isQwen = modelName.includes('qwen');
    
    console.error(`[${functionName}] Error calling Groq reasoning API with ${modelName}:`, error);
    
    // Extract target URL for logging if it exists in metadata
    let targetUrl = 'https://api.groq.com/openai/v1/chat/completions';
    if (metadata.url) {
      targetUrl = metadata.url;
    } else if (metadata.pageUrl) {
      targetUrl = metadata.pageUrl;
    }
    
    // Log the failed call
    await logModelCall(
      functionName,
      targetUrl,
      prompt,
      error.message,
      null,
      domain,
      { 
        ...metadata, 
        model: modelName,
        provider: 'groq',
        model_type: isGPTOSS ? 'gpt-oss' : isQwen ? 'qwen' : 'unknown',
        reasoning_effort: metadata.reasoningEffort || (isGPTOSS ? 'high' : 'default'),
        reasoning_format: metadata.reasoningFormat || null,
        include_reasoning: metadata.includeReasoning || null
      },
      'error'
    );
    
    throw error;
  }
}

// Re-export common utilities for convenience
export { estimateTokenCount };