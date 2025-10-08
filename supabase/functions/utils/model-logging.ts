// Model call logging utilities
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Groq from 'https://esm.sh/groq-sdk@0.7.0';

/**
 * Log a model call to the database
 * 
 * @param functionName The name of the function making the call
 * @param url The URL of the API endpoint
 * @param prompt The prompt sent to the model
 * @param response The response from the model
 * @param thinking The thinking content from the model (if any)
 * @param domain The domain context for the call
 * @param metadata Additional metadata about the call
 * @param status Status of the call (success, error, etc.)
 * @returns The ID of the log entry
 */
export async function logModelCall(
  functionName: string,
  url: string,
  prompt: string,
  response: string,
  thinking?: string,
  domain?: string,
  metadata: Record<string, any> = {},
  status: string = 'success'
): Promise<string | null> {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('[model-logging] Missing Supabase credentials, cannot log model call');
      return null;
    }
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    console.log(`[model-logging] Attempting to log model call for ${functionName} with status ${status}`);
    
    // Call the database function to log the model call
    const { data, error } = await supabase.rpc('log_model_call', {
      p_function_name: functionName,
      p_url: url,
      p_prompt: prompt,
      p_response: response,
      p_thinking: thinking || null,
      p_domain: domain || null,
      p_metadata: metadata,
      p_status: status
    });
    
    if (error) {
      console.error(`[model-logging] Error logging model call for ${functionName}:`, error);
      console.error(`[model-logging] Error details:`, JSON.stringify(error, null, 2));
      return null;
    }
    
    console.log(`[model-logging] Successfully logged model call for ${functionName}, log ID: ${data}`);
    return data;
  } catch (error) {
    console.error(`[model-logging] Failed to log model call for ${functionName}:`, error);
    console.error(`[model-logging] Stack trace:`, error.stack);
    return null;
  }
}

/**
 * Extracts thinking content from model response
 * 
 * @param response The full response from the model
 * @returns An object containing the clean response and thinking content
 */
export function extractThinking(response: string): { response: string, thinking: string | null } {
  // Check if there's a thinking section in the response
  const thinkStartMatch = response.match(/<think>([\s\S]*?)<\/think>/);
  
  if (!thinkStartMatch) {
    return { response, thinking: null };
  }
  
  const thinking = thinkStartMatch[1].trim();
  
  // Remove the thinking section from the response
  const cleanResponse = response
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .trim();
  
  return {
    response: cleanResponse,
    thinking
  };
}

/**
 * Estimates token count based on character count
 * Uses the rough approximation of 0.3 tokens per character
 * 
 * @param text The text to estimate tokens for
 * @returns Estimated token count
 */
export function estimateTokenCount(text: string | null): number {
  if (!text) return 0;
  return Math.ceil(text.length * 0.3);
}

/**
 * A wrapper function for DeepSeek API calls with automatic logging
 * 
 * @param functionName The name of the calling function
 * @param prompt The prompt to send to the model
 * @param apiKey The DeepSeek API key
 * @param domain Optional domain context
 * @param metadata Optional additional metadata
 * @returns The model's response with thinking extracted
 */
export async function callDeepSeekWithLogging(
  functionName: string,
  prompt: string,
  apiKey: string,
  domain?: string,
  metadata: Record<string, any> = {}
): Promise<{ response: string, thinking: string | null }> {
  const apiUrl = 'https://api.deepseek.com/chat/completions';
  
  try {
    console.log(`[${functionName}] Calling DeepSeek API...`);
    
    // Extract target URL for logging if it exists in metadata
    let targetUrl = apiUrl; // Default to API URL
    if (metadata.url) {
      targetUrl = metadata.url; // Use the target URL from metadata if available
      console.log(`[${functionName}] Using target URL for logging: ${targetUrl}`);
    } else if (metadata.pageUrl) {
      targetUrl = metadata.pageUrl; // Alternative field name
      console.log(`[${functionName}] Using page URL for logging: ${targetUrl}`);
    }
    
    const requestStart = Date.now();
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: metadata.modelName || 'deepseek-reasoner',
        messages: [
          { role: 'user', content: prompt },
        ],
        max_tokens: 8000,
        stream: false,
      }),
    });
    const requestDuration = Date.now() - requestStart;
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[${functionName}] DeepSeek API error: ${response.status}`, errorText);
      
      // Log the failed call
      await logModelCall(
        functionName,
        targetUrl, // Use target URL instead of API URL
        prompt,
        errorText,
        null,
        domain,
        { ...metadata, duration_ms: requestDuration },
        'error'
      );
      
      throw new Error(`DeepSeek API error: ${response.status} - ${errorText}`);
    }
    
    const data = await response.json();
    
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      console.error(`[${functionName}] Invalid response format from DeepSeek API:`, data);
      
      // Log the invalid response
      await logModelCall(
        functionName,
        targetUrl, // Use target URL instead of API URL
        prompt,
        JSON.stringify(data),
        null,
        domain,
        { ...metadata, duration_ms: requestDuration },
        'invalid_format'
      );
      
      throw new Error('Invalid response format from DeepSeek API');
    }
    
    const rawResponse = data.choices[0].message.content;
    let thinking = null;
    
    // Check if the response has a dedicated reasoning_content field (DeepSeek Reasoner)
    let cleanResponse;
    if (data.choices[0].message.reasoning_content) {
      console.log(`[${functionName}] Found DeepSeek reasoning_content field`);
      thinking = data.choices[0].message.reasoning_content;
      
      // Use the raw response directly as it doesn't need to be cleaned
      cleanResponse = rawResponse;
    } else {
      // Fall back to the traditional thinking tag extraction
      const extracted = extractThinking(rawResponse);
      cleanResponse = extracted.response;
      thinking = extracted.thinking;
    }
    
    // Calculate token counts
    const promptTokens = estimateTokenCount(prompt);
    const responseTokens = estimateTokenCount(cleanResponse);
    const thinkingTokens = estimateTokenCount(thinking);
    const totalTokens = promptTokens + responseTokens + thinkingTokens;
    
    // Log the successful call
    await logModelCall(
      functionName,
      targetUrl, // Use target URL instead of API URL
      prompt,
      cleanResponse,
      thinking,
      domain,
      { 
        ...metadata, 
        duration_ms: requestDuration,
        prompt_tokens: promptTokens,
        response_tokens: responseTokens,
        thinking_tokens: thinkingTokens,
        total_tokens: totalTokens
      },
      'success'
    );
    
    return { response: cleanResponse, thinking };
  } catch (error) {
    console.error(`[${functionName}] Error calling DeepSeek API:`, error);
    
    // If we haven't already logged this error (e.g., from earlier in the try block)
    if (error.message !== 'DeepSeek API error' && error.message !== 'Invalid response format from DeepSeek API') {
      // Extract target URL for logging if it exists in metadata
      let targetUrl = apiUrl; // Default to API URL
      if (metadata.url) {
        targetUrl = metadata.url; // Use the target URL from metadata if available
      } else if (metadata.pageUrl) {
        targetUrl = metadata.pageUrl; // Alternative field name
      }
      
      await logModelCall(
        functionName,
        targetUrl, // Use target URL instead of API URL
        prompt,
        error.message,
        null,
        domain,
        metadata,
        'exception'
      );
    }
    
    throw error;
  }
}

/**
 * A wrapper function for Kimi K2 API calls via Groq with automatic logging
 * 
 * @param functionName The name of the calling function
 * @param prompt The prompt to send to the model
 * @param domain Optional domain context
 * @param metadata Optional additional metadata
 * @returns The model's response with thinking extracted
 */
export async function callK2WithLogging(
  functionName: string,
  prompt: string,
  domain?: string,
  metadata: Record<string, any> = {}
): Promise<{ response: string, thinking: string | null }> {
  const apiKey = Deno.env.get('GROQ_API_KEY')
  
  if (!apiKey) {
    throw new Error('GROQ_API_KEY not found in environment variables')
  }
  
  try {
    console.log(`[${functionName}] Calling Kimi K2 API via Groq...`)
    
    let targetUrl = 'https://api.groq.com/openai/v1/chat/completions'
    if (metadata.url) {
      targetUrl = metadata.url
      console.log(`[${functionName}] Using target URL for logging: ${targetUrl}`)
    } else if (metadata.pageUrl) {
      targetUrl = metadata.pageUrl
      console.log(`[${functionName}] Using page URL for logging: ${targetUrl}`)
    }

    const groq = new Groq({ apiKey })
    const maxAttempts = Number(Deno.env.get('SYNOPSIS_MODEL_MAX_RETRIES') || 5)
    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

    const computeDelay = (attemptIndex: number, retryAfterHeader?: string): number => {
      if (retryAfterHeader) {
        const retrySeconds = Number(retryAfterHeader)
        if (!isNaN(retrySeconds) && retrySeconds > 0) {
          return Math.min(retrySeconds * 1000, 60000)
        }
      }
      const baseDelay = 2000
      const delay = Math.min(baseDelay * Math.pow(2, attemptIndex), 60000)
      const jitter = delay * 0.25
      return Math.round(delay - jitter + Math.random() * jitter * 2)
    }

    let attempt = 0
    let lastError: any = null

    while (attempt < maxAttempts) {
      attempt += 1
      try {
        const requestStart = Date.now()
        let fullResponse = ''

        const chatCompletion = await groq.chat.completions.create({
          messages: [
            {
              role: 'user',
              content: prompt,
            },
          ],
          model: metadata.modelName || 'moonshotai/kimi-k2-instruct',
          max_tokens: metadata.maxTokens || 8000,
          stream: true,
        })

        for await (const chunk of chatCompletion) {
          const content = chunk.choices[0]?.delta?.content || ''
          fullResponse += content
        }

        const requestDuration = Date.now() - requestStart
        const { response: cleanResponse, thinking } = extractThinking(fullResponse)

        const promptTokens = estimateTokenCount(prompt)
        const responseTokens = estimateTokenCount(cleanResponse)
        const thinkingTokens = estimateTokenCount(thinking)
        const totalTokens = promptTokens + responseTokens + thinkingTokens

        await logModelCall(
          functionName,
          targetUrl,
          prompt,
          cleanResponse,
          thinking,
          domain,
          {
            ...metadata,
            duration_ms: requestDuration,
            prompt_tokens: promptTokens,
            response_tokens: responseTokens,
            thinking_tokens: thinkingTokens,
            total_tokens: totalTokens,
            model: metadata.modelName || 'moonshotai/kimi-k2-instruct',
            provider: 'groq',
            attempts_used: attempt,
          },
          'success'
        )

        return { response: cleanResponse, thinking }

      } catch (error) {
        lastError = error
        const status = (error as any)?.status
        const headers = (error as any)?.headers || {}
        const retryAfterHeader = headers['retry-after'] || headers['Retry-After']

        const retryableStatuses = [408, 409, 420, 429, 500, 502, 503, 504]
        const canRetry = retryableStatuses.includes(status) ||
          ((error as Error)?.message?.toLowerCase()?.includes('rate limit') ?? false)

        if (!canRetry || attempt >= maxAttempts) {
          console.error(`[${functionName}] K2 request failed after ${attempt} attempts`, error)
          break
        }

        const delayMs = computeDelay(attempt - 1, retryAfterHeader)
        console.warn(`[${functionName}] K2 attempt ${attempt} failed (${(error as Error).message}). Retrying in ${delayMs}ms`)
        await sleep(delayMs)
      }
    }

    await logModelCall(
      functionName,
      targetUrl,
      prompt,
      lastError?.message || 'unknown error',
      null,
      domain,
      {
        ...metadata,
        model: metadata.modelName || 'moonshotai/kimi-k2-instruct',
        provider: 'groq',
        attempts_used: attempt,
      },
      'error'
    )

    throw lastError ?? new Error('K2 call failed without specific error')
  } catch (error) {
    console.error(`[${functionName}] Error calling Kimi K2 API:`, error)
    throw error
  }
}

export async function callLlamaMaverickWithLogging(
  functionName: string,
  prompt: string,
  domain?: string,
  metadata: Record<string, any> = {}
): Promise<{ response: string, thinking: string | null }> {
  const apiKey = Deno.env.get('GROQ_API_KEY')

  if (!apiKey) {
    throw new Error('GROQ_API_KEY not found in environment variables')
  }

  try {
    console.log(`[${functionName}] Calling Llama Maverick via Groq...`)

    let targetUrl = 'https://api.groq.com/openai/v1/chat/completions'
    if (metadata.url) {
      targetUrl = metadata.url
    } else if (metadata.pageUrl) {
      targetUrl = metadata.pageUrl
    }

    const requestStart = Date.now()
    const groq = new Groq({ apiKey })
    let fullResponse = ''

    const completionOptions: Record<string, any> = {
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      model: metadata.modelName || 'meta-llama/llama-4-maverick-17b-128e-instruct',
      temperature: metadata.temperature ?? 0.9,
      max_completion_tokens: metadata.maxTokens || metadata.max_completion_tokens || 8192,
      top_p: metadata.topP ?? 1,
      stream: true,
    }

    if (metadata.stop) {
      completionOptions.stop = metadata.stop
    }

    const chatCompletion = await groq.chat.completions.create(completionOptions)

    for await (const chunk of chatCompletion) {
      const content = chunk.choices[0]?.delta?.content || ''
      fullResponse += content
    }

    const requestDuration = Date.now() - requestStart
    const { response: cleanResponse, thinking } = extractThinking(fullResponse)

    const promptTokens = estimateTokenCount(prompt)
    const responseTokens = estimateTokenCount(cleanResponse)
    const thinkingTokens = estimateTokenCount(thinking)
    const totalTokens = promptTokens + responseTokens + thinkingTokens

    await logModelCall(
      functionName,
      targetUrl,
      prompt,
      cleanResponse,
      thinking,
      domain,
      {
        ...metadata,
        duration_ms: requestDuration,
        prompt_tokens: promptTokens,
        response_tokens: responseTokens,
        thinking_tokens: thinkingTokens,
        total_tokens: totalTokens,
        model: completionOptions.model,
        provider: 'groq',
      },
      'success'
    )

    return { response: cleanResponse, thinking }
  } catch (error) {
    console.error(`[${functionName}] Error calling Llama Maverick API:`, error)

    let targetUrl = 'https://api.groq.com/openai/v1/chat/completions'
    if (metadata.url) {
      targetUrl = metadata.url
    } else if (metadata.pageUrl) {
      targetUrl = metadata.pageUrl
    }

    await logModelCall(
      functionName,
      targetUrl,
      prompt,
      error.message,
      null,
      domain,
      {
        ...metadata,
        model: metadata.modelName || 'meta-llama/llama-4-maverick-17b-128e-instruct',
        provider: 'groq',
      },
      'error'
    )

    throw error
  }
}

/**
 * Universal model caller that switches between different models based on environment variable
 * 
 * @param functionName The name of the calling function
 * @param prompt The prompt to send to the model
 * @param domain Optional domain context
 * @param metadata Optional additional metadata
 * @returns The model's response with thinking extracted
 */
export async function callModelWithLogging(
  functionName: string,
  prompt: string,
  domain?: string,
  metadata: Record<string, any> = {}
): Promise<{ response: string, thinking: string | null }> {
  const primaryModel = (Deno.env.get('SYNOPSIS_MODEL') || 'deepseek').toLowerCase()
  const fallbackChain = parseFallbackModels(primaryModel)

  let lastError: any = null

  for (const attempt of fallbackChain) {
    try {
      console.log(`[${functionName}] Using model type: ${attempt}`)
      return await callModelByType(attempt, functionName, prompt, domain, {
        ...metadata,
        attempt_model: attempt,
      })
    } catch (error) {
      lastError = error

      if (!shouldAttemptFallback(error)) {
        throw error
      }

      console.warn(`[${functionName}] Model ${attempt} failed with ${error?.status || 'unknown status'} - attempting fallback`)
    }
  }

  throw lastError || new Error('Model invocation failed with no further fallbacks available')
}

function parseFallbackModels(primary: string): string[] {
  const fallbackEnv = Deno.env.get('SYNOPSIS_MODEL_FALLBACKS')
  const configured = fallbackEnv
    ? fallbackEnv
        .split(',')
        .map(value => value.trim().toLowerCase())
        .filter(Boolean)
    : ['k2', 'gpt-oss', 'llama', 'deepseek']

  const unique = new Set<string>([primary])
  const ordered = [primary]

  for (const candidate of configured) {
    if (!unique.has(candidate)) {
      unique.add(candidate)
      ordered.push(candidate)
    }
  }

  return ordered
}

function shouldAttemptFallback(error: any): boolean {
  const retryableStatus = [408, 409, 420, 429, 500, 502, 503, 504]
  const status = error?.status ?? error?.response?.status
  if (status && retryableStatus.includes(status)) {
    return true
  }

  const message = (error?.message || '').toLowerCase()
  const retryPhrases = [
    'rate limit',
    'over capacity',
    'temporarily unavailable',
    'timed out',
    'timeout',
    'quota exceeded',
    'try again',
  ]

  return retryPhrases.some(phrase => message.includes(phrase))
}

async function callModelByType(
  modelType: string,
  functionName: string,
  prompt: string,
  domain?: string,
  metadata: Record<string, any> = {}
): Promise<{ response: string, thinking: string | null }> {
  switch (modelType) {
    case 'k2':
    case 'kimi':
      return await callK2WithLogging(functionName, prompt, domain, metadata)

    case 'gptoss':
    case 'gpt-oss':
    case 'gpt120':
    case 'gpt-120':
      return await callGPT120OSSWithLogging(functionName, prompt, domain, metadata)

    case 'llama':
    case 'meta-llama':
    case 'llama-maverick':
      return await callLlamaMaverickWithLogging(functionName, prompt, domain, metadata)

    case 'deepseek':
    default:
      const deepseekApiKey = Deno.env.get('DEEPSEEK_API_KEY')
      if (!deepseekApiKey) {
        throw new Error('DEEPSEEK_API_KEY not found in environment variables')
      }
      return await callDeepSeekWithLogging(functionName, prompt, deepseekApiKey, domain, metadata)
  }
}

/**
 * A wrapper function for GPT-OSS-120B API calls via Groq with automatic logging
 * Supports advanced features like reasoning_effort and browser_search tools
 * 
 * @param functionName The name of the calling function
 * @param prompt The prompt to send to the model
 * @param domain Optional domain context
 * @param metadata Optional additional metadata (can include reasoningEffort, tools, temperature, etc.)
 * @returns The model's response with thinking extracted
 */
export async function callGPT120OSSWithLogging(
  functionName: string,
  prompt: string,
  domain?: string,
  metadata: Record<string, any> = {}
): Promise<{ response: string, thinking: string | null }> {
  const apiKey = Deno.env.get('GROQ_API_KEY')
  
  if (!apiKey) {
    throw new Error('GROQ_API_KEY not found in environment variables')
  }
  
  try {
    console.log(`[${functionName}] Calling GPT-OSS-120B API via Groq...`)
    
    // Extract target URL for logging if it exists in metadata
    let targetUrl = 'https://api.groq.com/openai/v1/chat/completions' // Default to Groq API URL
    if (metadata.url) {
      targetUrl = metadata.url // Use the target URL from metadata if available
      console.log(`[${functionName}] Using target URL for logging: ${targetUrl}`)
    } else if (metadata.pageUrl) {
      targetUrl = metadata.pageUrl // Alternative field name
      console.log(`[${functionName}] Using page URL for logging: ${targetUrl}`)
    }
    
    const requestStart = Date.now()
    
    // Initialize Groq client
    const groq = new Groq({
      apiKey: apiKey,
    })
    
    // Collect the full response and reasoning from streaming
    let fullResponse = ''
    let reasoning = ''  // GPT-OSS returns reasoning as a separate field
    
    // Build the completion options
    const completionOptions: any = {
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      model: 'openai/gpt-oss-120b',
      temperature: metadata.temperature ?? 1,
      max_completion_tokens: metadata.maxTokens || 65536,
      top_p: metadata.topP ?? 1,
      stream: true,
      include_reasoning: true,  // IMPORTANT: GPT-OSS needs this to return reasoning
      reasoning_effort: metadata.reasoningEffort || 'medium',
      stop: metadata.stop || null,
    }
    
    console.log(`[${functionName}] GPT-OSS completion options:`, {
      model: completionOptions.model,
      include_reasoning: completionOptions.include_reasoning,
      reasoning_effort: completionOptions.reasoning_effort,
      stream: completionOptions.stream
    })
    
    // Add tools if specified
    if (metadata.tools) {
      completionOptions.tools = metadata.tools
    } else if (metadata.useBrowserSearch) {
      completionOptions.tools = [{ type: 'browser_search' }]
    }
    
    // Create the chat completion with streaming
    const chatCompletion = await groq.chat.completions.create(completionOptions)
    
    // Process the stream and collect the response
    let chunkCount = 0
    let reasoningChunks = 0
    for await (const chunk of chatCompletion) {
      chunkCount++
      
      // Debug: Log first few chunks to see structure
      if (chunkCount <= 3) {
        console.log(`[${functionName}] Chunk ${chunkCount} structure:`, JSON.stringify(chunk, null, 2))
      }
      
      // Handle reasoning content (GPT-OSS models with include_reasoning=true)
      // GPT-OSS returns reasoning in delta.reasoning field, not delta.reasoning_content
      if (chunk.choices[0]?.delta?.reasoning) {
        reasoning += chunk.choices[0].delta.reasoning
        reasoningChunks++
        if (reasoningChunks === 1) {
          console.log(`[${functionName}] First reasoning chunk detected!`)
        }
      }
      
      // Handle regular content
      const content = chunk.choices[0]?.delta?.content || ''
      fullResponse += content
    }
    
    console.log(`[${functionName}] Stream processing complete:`, {
      totalChunks: chunkCount,
      reasoningChunks,
      responseLength: fullResponse.length,
      reasoningLength: reasoning.length
    })
    
    const requestDuration = Date.now() - requestStart
    
    // For GPT-OSS, reasoning is already captured from the stream
    // No need to extract from content since it comes in a separate field
    const cleanResponse = fullResponse
    const thinking = reasoning || null
    
    console.log(`[${functionName}] Final thinking status:`, {
      hasThinking: !!thinking,
      thinkingLength: thinking ? thinking.length : 0,
      thinkingPreview: thinking ? thinking.substring(0, 100) + '...' : 'none'
    })
    
    // Calculate token counts
    const promptTokens = estimateTokenCount(prompt)
    const responseTokens = estimateTokenCount(cleanResponse)
    const thinkingTokens = estimateTokenCount(thinking)
    const totalTokens = promptTokens + responseTokens + thinkingTokens
    
    // Log the successful call
    await logModelCall(
      functionName,
      targetUrl,
      prompt,
      cleanResponse,
      thinking,
      domain,
      { 
        ...metadata, 
        duration_ms: requestDuration,
        prompt_tokens: promptTokens,
        response_tokens: responseTokens,
        thinking_tokens: thinkingTokens,
        total_tokens: totalTokens,
        model: 'openai/gpt-oss-120b',
        provider: 'groq',
        reasoning_effort: metadata.reasoningEffort || 'medium',
        tools_used: metadata.tools || (metadata.useBrowserSearch ? [{ type: 'browser_search' }] : [])
      },
      'success'
    )
    
    return { response: cleanResponse, thinking }
  } catch (error) {
    console.error(`[${functionName}] Error calling GPT-OSS-120B API:`, error)
    
    // Extract target URL for logging if it exists in metadata
    let targetUrl = 'https://api.groq.com/openai/v1/chat/completions'
    if (metadata.url) {
      targetUrl = metadata.url
    } else if (metadata.pageUrl) {
      targetUrl = metadata.pageUrl
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
        model: 'openai/gpt-oss-120b',
        provider: 'groq',
        reasoning_effort: metadata.reasoningEffort || 'medium'
      },
      'error'
    )
    
    throw error
  }
}
