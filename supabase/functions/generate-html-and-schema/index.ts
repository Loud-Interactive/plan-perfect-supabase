// supabase/functions/generate-html-and-schema/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.4.0'
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
    const { job_id, template } = await req.json()
    
    if (!job_id) {
      return new Response(JSON.stringify({ error: 'Job ID is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    console.log(`Generating HTML and Schema for job ID: ${job_id}`)
    
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Get the edit job
    const { data: editJob, error: editJobError } = await supabase
      .from('edit_jobs')
      .select('*, documents(*)')
      .eq('id', job_id)
      .eq('is_deleted', false)
      .single();
    
    if (editJobError || !editJob) {
      console.error('Error fetching edit job:', editJobError);
      return new Response(JSON.stringify({ 
        error: `Failed to fetch edit job: ${editJobError?.message || 'Job not found'}` 
      }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    // Get the content to convert to HTML
    const contentToConvert = editJob.edited_content || editJob.original_content;
    
    if (!contentToConvert) {
      console.error('No content available to convert');
      return new Response(JSON.stringify({ 
        error: 'No content available to convert to HTML' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    // Use default template if not provided
    const htmlTemplate = template || `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{title}}</title>
    <meta name="description" content="{{description}}">
    <style>
        body {
            font-family: Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
        }
        h1, h2, h3, h4, h5, h6 {
            color: #2c3e50;
            margin-top: 1.5em;
        }
        a {
            color: #3498db;
        }
        img {
            max-width: 100%;
            height: auto;
        }
        pre, code {
            background-color: #f5f5f5;
            border-radius: 3px;
            padding: 2px 5px;
        }
        blockquote {
            border-left: 4px solid #e0e0e0;
            margin-left: 0;
            padding-left: 20px;
            color: #7f8c8d;
        }
    </style>
</head>
<body>
    <main>
        {{content}}
    </main>
    <script type="application/ld+json">
        {{schema}}
    </script>
</body>
</html>`;
    
    // Initialize Anthropic client
    const anthropic = new Anthropic({
      apiKey: Deno.env.get('ANTHROPIC_API_KEY') || '',
    });
    
    // Prepare the prompt for HTML and schema generation
    const promptText = generateHtmlPrompt(contentToConvert, htmlTemplate);
    
    console.log('Generating HTML and schema with Claude using streaming...');
    
    // Generate the HTML and schema with Claude using streaming
    let thinking = null;
    let textContent = '';
    let htmlOutput = '';
    let jsonLdOutput = '';
    
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
      
      // Extract thinking and text content from the final message
      if (finalMessage && finalMessage.content) {
        for (const contentBlock of finalMessage.content) {
          console.log(`Processing content block of type: ${contentBlock.type}`);
          
          if (contentBlock.type === 'thinking' && contentBlock.thinking) {
            thinking = contentBlock.thinking;
            console.log('Extracted thinking content');
          } else if (contentBlock.type === 'text') {
            textContent = contentBlock.text;
            console.log(`Extracted final text content (${textContent.length} chars)`);
          }
        }
      }
      
      console.log('HTML and schema generation complete');
      console.log(`Response length: ${textContent.length} characters`);
    } catch (streamError) {
      console.error('Error during streaming:', streamError);
      throw new Error(`Error during streaming response: ${streamError.message}`);
    }
    
    // Parse the response
    const thinkingMatch = textContent.match(/<thinking>([\s\S]*?)<\/thinking>/i);
    const htmlMatch = textContent.match(/<html>([\s\S]*?)<\/html>/i);
    const jsonLdMatch = textContent.match(/<json-ld>([\s\S]*?)<\/json-ld>/i);
    
    if (thinkingMatch && thinkingMatch[1]) {
      if (!thinking) {  // Only use this if we didn't get thinking from the stream
        thinking = thinkingMatch[1].trim();
      }
      console.log(`Extracted thinking content from text: ${thinking.length} characters`);
    }
    
    if (htmlMatch && htmlMatch[1]) {
      htmlOutput = htmlMatch[1].trim();
      console.log(`Extracted HTML: ${htmlOutput.length} characters`);
    }
    
    if (jsonLdMatch && jsonLdMatch[1]) {
      jsonLdOutput = jsonLdMatch[1].trim();
      console.log(`Extracted JSON-LD: ${jsonLdOutput.length} characters`);
    }
    
    // Store thinking in the thinking_logs table
    if (thinking) {
      await supabase
        .from('thinking_logs')
        .insert({
          job_id: job_id,
          thinking: thinking,
          prompt_type: 'html',
          insight_tags: extractInsightTags(thinking)
        });
    }
    
    // Parse the JSON-LD
    let jsonLdObject = null;
    try {
      if (jsonLdOutput) {
        jsonLdObject = JSON.parse(jsonLdOutput);
        console.log('Successfully parsed JSON-LD');
      }
    } catch (jsonError) {
      console.error('Error parsing JSON-LD:', jsonError);
    }
    
    // Update the document with the HTML and JSON-LD
    if (htmlOutput || jsonLdObject) {
      await supabase
        .from('documents')
        .update({
          html: htmlOutput || null,
          json_ld: jsonLdObject
        })
        .eq('id', editJob.document_id);
      
      console.log('Updated document with HTML and JSON-LD');
    }
    
    // Return success response
    return new Response(JSON.stringify({ 
      success: true,
      job_id: job_id,
      html: htmlOutput || null,
      json_ld: jsonLdObject
    }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });
  } catch (error) {
    console.error('Error in generate-html-and-schema function:', error);
    
    return new Response(
      JSON.stringify({ 
        error: `Failed to generate HTML and schema: ${error.message}` 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    );
  }
});

// Function to generate the HTML and schema prompt
function generateHtmlPrompt(content, template) {
  return `You are a specialized content formatter tasked with converting markdown content into structured HTML according to a template. Your goal is to preserve the content's meaning while creating well-formatted, semantically correct HTML that maintains the provided structure.

Here is the markdown content to convert:
<markdown>
${content}
</markdown>

Here is the HTML template to follow:
<template>
${template}
</template>

INSTRUCTIONS:
1. Carefully analyze the markdown content and the HTML template structure
2. Convert the markdown to HTML while maintaining the template's structure and styling
3. Ensure proper semantic HTML elements are used (headings, paragraphs, lists, etc.)
4. Preserve all links, emphasis, and other markdown formatting
5. Generate appropriate JSON-LD schema for SEO purposes based on the content

Think through your conversion process step by step:
- How is the template structured?
- What parts of the template should remain unchanged?
- Where and how should the markdown content be integrated?
- What semantic HTML elements best represent each markdown component?
- What schema.org types and properties are appropriate for this content?

Place your detailed thought process in <thinking> tags.

Please provide your conversion in the following format:

<thinking>
[Your detailed step-by-step reasoning about the HTML conversion process, including:
- Analysis of template structure
- Decisions about how to integrate content
- Selection of semantic HTML elements
- Schema.org type selection rationale
- Any challenges encountered and how you resolved them]
</thinking>

<html>
[Your complete HTML output with the markdown content properly integrated into the template]
</html>

<json-ld>
{
  "@context": "https://schema.org",
  "@type": "appropriate-type",
  "property": "value",
  ...
}
</json-ld>`;
}

// Function to extract insight tags from thinking
function extractInsightTags(thinking) {
  // Extract key phrases that might be useful for categorization
  const potentialTags = [];
  
  // Look for mentions of HTML elements
  const elementMatches = thinking.match(/html element[s]? ([\w\s,]+)/gi);
  if (elementMatches) {
    for (const match of elementMatches) {
      const element = match.replace(/html element[s]? /i, '').trim();
      if (element) potentialTags.push(`element:${element}`);
    }
  }
  
  // Look for mentions of schema types
  const schemaMatches = thinking.match(/schema[.]org type[s]? ([\w\s,]+)/gi);
  if (schemaMatches) {
    for (const match of schemaMatches) {
      const schema = match.replace(/schema[.]org type[s]? /i, '').trim();
      if (schema) potentialTags.push(`schema:${schema}`);
    }
  }
  
  // Add some generic categories based on thinking content
  if (thinking.includes('semantic')) potentialTags.push('semantic_html');
  if (thinking.includes('accessibility')) potentialTags.push('accessibility');
  if (thinking.includes('structure')) potentialTags.push('structure');
  if (thinking.includes('metadata')) potentialTags.push('metadata');
  if (thinking.includes('responsive')) potentialTags.push('responsive');
  if (thinking.includes('template')) potentialTags.push('template');
  if (thinking.includes('JSON-LD')) potentialTags.push('json_ld');
  
  return potentialTags.slice(0, 10); // Limit to 10 tags
}