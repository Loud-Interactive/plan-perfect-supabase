// supabase/functions/generate-style-guide-from-outline/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.4.0'
import Anthropic from 'npm:@anthropic-ai/sdk';
import TurndownService from 'npm:turndown';

serve(async (req) => {
  // Set CORS headers for all responses
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  }

  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders, status: 204 })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  
  try {
    // Parse the request body
    const { content_plan_outline_guid } = await req.json()
    
    if (!content_plan_outline_guid) {
      return new Response(JSON.stringify({ error: 'content_plan_outline_guid is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    console.log(`Generating style guide for content plan outline GUID: ${content_plan_outline_guid}`)
    
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Get content from the tasks table
    const { data: taskData, error: taskError } = await supabase
      .from('tasks')
      .select('*')
      .eq('content_plan_outline_guid', content_plan_outline_guid)
      .single();
    
    if (taskError || !taskData) {
      console.error('Error fetching task data:', taskError);
      return new Response(JSON.stringify({ 
        error: `Failed to fetch task: ${taskError?.message || 'Task not found'}` 
      }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    // Extract the HTML content
    const htmlContent = taskData.content;
    
    if (!htmlContent) {
      console.error('No content available to generate style guide');
      return new Response(JSON.stringify({ 
        error: 'No content available in the task' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    // Convert HTML to Markdown
    const turndownService = new TurndownService();
    const markdownContent = turndownService.turndown(htmlContent);
    
    console.log(`Converted HTML to Markdown (${markdownContent.length} characters)`);
    
    // Prepare the prompt for style guide generation
    const promptText = `You are tasked with creating a comprehensive style guide based on the following content. This style guide will be used to instruct an AI model to generate content in the same style and tone as the original piece. Your analysis should cover elements such as style, tone, voice, word usage, and cadence.

Here is the content to analyze:

<content>
${markdownContent}
</content>

Please follow these steps:

1. Analyze the content, paying close attention to:
   - Overall tone (e.g., formal, casual, humorous)
   - Voice (e.g., first-person, second-person, third-person)
   - Word choice and vocabulary level
   - Sentence structure and length
   - Paragraph structure
   - Use of literary devices (e.g., metaphors, similes)
   - Punctuation and formatting choices
   - Any unique stylistic elements or quirks

2. Synthesize your findings into a comprehensive style guide that captures the essence of the writing style present in this piece.

3. Your style guide should include specific instructions and examples for each element of style you've identified. Be as detailed and precise as possible to ensure that an AI model could accurately replicate this style.

4. Present your final style guide within <style_guide> tags. Structure your guide with clear headings and subheadings for easy reference.

Remember, your output should consist of only the final style guide within the specified tags. Do not include your individual analyses of the piece or any other commentary outside of the style guide itself.`;

    // Initialize Anthropic client
    const anthropic = new Anthropic({
      apiKey: Deno.env.get('ANTHROPIC_API_KEY') || '',
    });
    
    console.log('Generating style guide with Claude using streaming...');
    
    // Generate the style guide with Claude using streaming
    let fullContent = '';
    let thinking = null;
    let textContent = '';
    
    try {
      // Create a streaming request
      const stream = await anthropic.beta.messages.stream({
        model: "claude-3-7-sonnet-20250219",
        max_tokens: 86000,
        temperature: 1,
        messages: [
          {
            role: "user",
            content: promptText
          }
        ],
        thinking: {
          type: "enabled",
          budget_tokens: 23000
        },
        betas: ["output-128k-2025-02-19"]
      });
      
      // Collect streamed chunks
      for await (const chunk of stream) {
        if (chunk.type === 'content_block_delta' && chunk.delta.text) {
          textContent += chunk.delta.text;
        }
      }
      
      // Wait for the final message to ensure we have all content
      const finalMessage = await stream.finalMessage();
      console.log('Received final message from stream');
      
      if (finalMessage) {
        console.log(`Final message content types: ${finalMessage.content ? finalMessage.content.map(c => c.type).join(', ') : 'No content array'}`);
      }
      
      // Extract thinking and text content from the final message
      if (finalMessage && finalMessage.content) {
        for (const contentBlock of finalMessage.content) {
          console.log(`Processing content block of type: ${contentBlock.type}`);
          
          if (contentBlock.type === 'thinking' && contentBlock.thinking) {
            thinking = contentBlock.thinking;
            console.log('Extracted thinking content');
          } else if (contentBlock.type === 'text') {
            fullContent = contentBlock.text;
            console.log(`Extracted final text content (${contentBlock.text.length} chars)`);
          }
        }
      }
      
      // If we didn't get the full content from the final message, use what we collected during streaming
      if (!fullContent && textContent) {
        console.log('Using content collected during streaming');
        fullContent = textContent;
      }
      
      console.log('Style guide generation complete');
      console.log(`Response length: ${fullContent.length} characters`);
    } catch (streamError) {
      console.error('Error during streaming:', streamError);
      throw new Error(`Error during streaming response: ${streamError.message}`);
    }
    
    // Extract just the style guide content between the tags
    let styleGuide = fullContent;
    const styleGuideMatch = fullContent.match(/<style_guide>([\s\S]*?)<\/style_guide>/i);
    
    if (styleGuideMatch && styleGuideMatch[1]) {
      styleGuide = styleGuideMatch[1].trim();
      console.log(`Extracted style guide: ${styleGuide.length} characters`);
    } else {
      console.log('Style guide tags not found, using full response');
    }
    
    // Save the style guide
    const { data: saveData, error: saveError } = await supabase
      .from('style_guides')
      .insert({
        content_plan_outline_guid,
        style_guide: styleGuide,
        thinking: thinking,
        source_content_length: markdownContent.length,
        task_id: taskData.task_id
      })
      .select('id')
      .single();
    
    if (saveError) {
      console.error('Error saving style guide:', saveError);
      
      return new Response(JSON.stringify({ 
        content_plan_outline_guid,
        style_guide: styleGuide,
        thinking: thinking,
        save_status: {
          success: false,
          message: `Error saving style guide: ${saveError.message}`
        }
      }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      });
    }
    
    console.log('Style guide saved successfully:', saveData);
    
    // Also update the task with a reference to the style guide
    await supabase
      .from('tasks')
      .update({
        style_guide_id: saveData.id,
        style_guide_status: 'Complete'
      })
      .eq('task_id', taskData.task_id);
    
    // Return the style guide
    return new Response(JSON.stringify({ 
      content_plan_outline_guid,
      style_guide: styleGuide,
      thinking: thinking,
      save_status: {
        success: true,
        message: 'Style guide saved successfully',
        style_guide_id: saveData.id
      }
    }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });
  } catch (error) {
    console.error('Error generating style guide from outline:', error);
    
    return new Response(
      JSON.stringify({ 
        error: `Failed to generate style guide from outline: ${error.message}` 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    );
  }
});