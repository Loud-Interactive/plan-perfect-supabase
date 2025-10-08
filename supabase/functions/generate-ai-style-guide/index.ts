// supabase/functions/generate-ai-style-guide/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import Anthropic from 'npm:@anthropic-ai/sdk';

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
    const { domain, urls, save = true } = await req.json()
    
    if (!domain) {
      return new Response(JSON.stringify({ error: 'Domain is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return new Response(JSON.stringify({ error: 'At least one URL is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    // Limit to 3 URLs maximum
    const postUrls = urls.slice(0, 3)
    console.log(`Generating style guide for domain: ${domain} with ${postUrls.length} URLs`)
    
    // Get the Supabase URL and anon key for calling other functions
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
    
    // Fetch markdown content for each URL - handle failures gracefully
    const contentResults = await Promise.allSettled(
      postUrls.map(async (url, index) => {
        console.log(`Fetching content for URL ${index + 1}: ${url}`)
        
        try {
          const response = await fetch(`${supabaseUrl}/functions/v1/fetch-markdown-content`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${supabaseAnonKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ url })
          })
          
          if (!response.ok) {
            const errorText = await response.text()
            console.error(`Failed to fetch markdown for URL ${index + 1}: ${errorText}`)
            return { success: false, url, error: errorText }
          }
          
          const data = await response.json()
          console.log(`Successfully fetched content for URL ${index + 1} (${data.length} characters)`)
          
          return { success: true, url, markdown: data.markdown }
        } catch (error) {
          console.error(`Error fetching content for URL ${index + 1}: ${error.message}`)
          return { success: false, url, error: error.message }
        }
      })
    )
    
    // Filter out failed fetches and extract successful content
    const successfulFetches = contentResults
      .filter(result => result.status === 'fulfilled' && result.value.success)
      .map(result => (result.status === 'fulfilled' ? result.value.markdown : ''))
    
    // Track failed URLs
    const failedUrls = contentResults
      .filter(result => result.status === 'rejected' || (result.status === 'fulfilled' && !result.value.success))
      .map(result => {
        if (result.status === 'rejected') {
          return { url: 'Unknown URL', reason: result.reason || 'Unknown error' }
        } else if (result.status === 'fulfilled') {
          return { url: result.value.url, reason: result.value.error || 'Unknown error' }
        }
      })
    
    // Check if we have any successful content to analyze
    if (successfulFetches.length === 0) {
      throw new Error(`Failed to fetch content from any of the provided URLs. Please try different URLs.`)
    }
    
    console.log(`Successfully fetched content from ${successfulFetches.length} URLs, ${failedUrls.length} failed.`)
    
    // Use the successful fetches as our content
    const contents = successfulFetches
    
    // Initialize Anthropic client
    const anthropic = new Anthropic({
      apiKey: Deno.env.get('ANTHROPIC_API_KEY') || '',
    });
    
    // Prepare the prompt by replacing placeholders with actual content
    let promptText = `You are tasked with creating a comprehensive style guide based on ${contents.length} pieces of content from the domain ${domain}. This style guide will be used to instruct an AI model to generate content in the same style and tone as the original pieces. Your analysis should cover elements such as style, tone, voice, word usage, and cadence.

${failedUrls.length > 0 ? `Note: ${failedUrls.length} URLs failed to fetch and have been omitted from the analysis.` : ''}

Here are the ${contents.length} pieces of content to analyze:

<content1>
${contents[0]}
</content1>
`
    
    // Add content2 if available
    if (contents.length >= 2) {
      promptText += `
<content2>
${contents[1]}
</content2>
`
    }
    
    // Add content3 if available
    if (contents.length >= 3) {
      promptText += `
<content3>
${contents[2]}
</content3>
`
    }
    
    promptText += `
Please follow these steps:

1. Analyze each piece of content individually, paying close attention to:
   - Overall tone (e.g., formal, casual, humorous)
   - Voice (e.g., first-person, second-person, third-person)
   - Word choice and vocabulary level
   - Sentence structure and length
   - Paragraph structure
   - Use of literary devices (e.g., metaphors, similes)
   - Punctuation and formatting choices
   - Any unique stylistic elements or quirks

2. After analyzing each piece, identify common elements and patterns across all pieces.

3. Synthesize your findings into a comprehensive style guide that captures the essence of the writing style present in these pieces.

4. Your style guide should include specific instructions and examples for each element of style you've identified. Be as detailed and precise as possible to ensure that an AI model could accurately replicate this style.

5. Present your final style guide within <style_guide> tags. Structure your guide with clear headings and subheadings for easy reference.

Remember, your output should consist of only the final style guide within the specified tags. Do not include your individual analyses of each piece or any other commentary outside of the style guide itself.`

    console.log('Generating style guide with Claude using streaming...')
    
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
    
    // If save is true, save the style guide to preferencesPerfect
    if (save) {
      console.log('Saving style guide to preferencesPerfect...')
      
      try {
        // Save the style guide using the save-ai-style-guide function
        const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
        const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
        
        const saveResponse = await fetch(`${supabaseUrl}/functions/v1/save-ai-style-guide`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseAnonKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            domain,
            style_guide: styleGuide,
            thinking: thinking
          })
        });
        
        if (!saveResponse.ok) {
          const saveErrorData = await saveResponse.json();
          console.error('Error saving style guide:', saveErrorData);
          
          return new Response(JSON.stringify({ 
            domain, 
            urls: {
              requested: postUrls,
              successful: contentResults
                .filter(result => result.status === 'fulfilled' && result.value.success)
                .map(result => result.status === 'fulfilled' ? result.value.url : ''),
              failed: failedUrls
            }, 
            style_guide: styleGuide,
            thinking: thinking,
            save_status: {
              success: false,
              message: saveErrorData.message || 'Failed to save style guide'
            }
          }), { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200
          });
        }
        
        const saveData = await saveResponse.json();
        console.log('Style guide saved successfully:', saveData);
        
        return new Response(JSON.stringify({ 
          domain, 
          urls: {
            requested: postUrls,
            successful: contentResults
              .filter(result => result.status === 'fulfilled' && result.value.success)
              .map(result => result.status === 'fulfilled' ? result.value.url : ''),
            failed: failedUrls
          }, 
          style_guide: styleGuide,
          thinking: thinking,
          save_status: {
            success: true,
            message: 'Style guide saved successfully'
          }
        }), { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200
        });
      } catch (saveError) {
        console.error('Error saving style guide:', saveError);
        
        return new Response(JSON.stringify({ 
          domain, 
          urls: {
            requested: postUrls,
            successful: contentResults
              .filter(result => result.status === 'fulfilled' && result.value.success)
              .map(result => result.status === 'fulfilled' ? result.value.url : ''),
            failed: failedUrls
          }, 
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
    }
    
    // Return the style guide without saving
    return new Response(JSON.stringify({ 
      domain, 
      urls: {
        requested: postUrls,
        successful: contentResults
          .filter(result => result.status === 'fulfilled' && result.value.success)
          .map(result => result.status === 'fulfilled' ? result.value.url : ''),
        failed: failedUrls
      }, 
      style_guide: styleGuide,
      thinking: thinking
    }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    })
  } catch (error) {
    console.error('Error generating style guide:', error)
    
    return new Response(
      JSON.stringify({ 
        error: `Failed to generate style guide: ${error.message}` 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    )
  }
})