// supabase/functions/process-style-transformation/index.ts
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
    const { job_id } = await req.json()
    
    if (!job_id) {
      return new Response(JSON.stringify({ error: 'Job ID is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    console.log(`Processing style transformation for job ID: ${job_id}`)
    
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
    
    // Update job status to processing
    await supabase
      .from('edit_jobs')
      .update({ status: 'processing' })
      .eq('id', job_id);
    
    // Get style guide
    let styleGuide = null;
    
    if (editJob.documents?.domain) {
      const { data: styleGuideData, error: styleGuideError } = await supabase
        .from('preferences_perfect')
        .select('ai_style_guide')
        .eq('domain', editJob.documents.domain)
        .single();
      
      if (!styleGuideError && styleGuideData && styleGuideData.ai_style_guide) {
        styleGuide = styleGuideData.ai_style_guide;
        console.log(`Found style guide for domain: ${editJob.documents.domain}`);
      }
    }
    
    // If no style guide found, use a default one
    if (!styleGuide) {
      styleGuide = {
        clientInfo: {
          name: editJob.documents?.domain || 'Generic',
          domain: editJob.documents?.domain || 'example.com',
          brandValues: ['Quality', 'Professionalism', 'Expertise']
        },
        voice: {
          prompt: 'Professional, clear, and informative',
          tone: ['Professional', 'Helpful', 'Informative'],
          traits: ['Knowledgeable', 'Clear', 'Direct'],
          languageStyle: 'Business formal with accessible language',
          linguisticStyle: 'Concise and factual',
          frequentPhrases: ['In summary', "It's important to note", 'Consider this']
        },
        content: {
          preferredFormats: ['Lists', 'Short paragraphs', 'Subheadings'],
          trademarkWords: [],
          avoidTopics: ['Politics', 'Religion', 'Controversial social issues']
        },
        competitors: {
          names: [],
          domains: []
        }
      };
      
      console.log('Using default style guide');
    }
    
    // Initialize Anthropic client
    const anthropic = new Anthropic({
      apiKey: Deno.env.get('ANTHROPIC_API_KEY') || '',
    });
    
    // Prepare the prompt for style transformation
    const contentToEdit = editJob.original_content;
    
    const promptText = generateStylePrompt(styleGuide, contentToEdit);
    
    console.log('Generating style transformation with Claude using streaming...');
    
    // Generate the style transformation with Claude using streaming
    let thinking = null;
    let textContent = '';
    let editedContent = '';
    let analysisText = '';
    let editsJson = null;
    let continueProcessing = false;
    
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
            console.log(`Extracted final text content (${contentBlock.text.length} chars)`);
          }
        }
      }
      
      console.log('Style transformation generation complete');
      console.log(`Response length: ${textContent.length} characters`);
    } catch (streamError) {
      console.error('Error during streaming:', streamError);
      
      // Update job status to failed
      await supabase
        .from('edit_jobs')
        .update({ 
          status: 'failed',
          error: `Error during streaming response: ${streamError.message}`
        })
        .eq('id', job_id);
      
      throw new Error(`Error during streaming response: ${streamError.message}`);
    }
    
    // Parse the response
    const thinkingMatch = textContent.match(/<thinking>([\s\S]*?)<\/thinking>/i);
    const analysisMatch = textContent.match(/<analysis>([\s\S]*?)<\/analysis>/i);
    const editsMatch = textContent.match(/<edits>([\s\S]*?)<\/edits>/i);
    const continueMatch = textContent.match(/<continue>([\s\S]*?)<\/continue>/i);
    
    if (thinkingMatch && thinkingMatch[1]) {
      if (!thinking) {  // Only use this if we didn't get thinking from the stream
        thinking = thinkingMatch[1].trim();
      }
      console.log(`Extracted thinking content from text: ${thinking.length} characters`);
    }
    
    if (analysisMatch && analysisMatch[1]) {
      analysisText = analysisMatch[1].trim();
      console.log(`Extracted analysis: ${analysisText.length} characters`);
    }
    
    if (editsMatch && editsMatch[1]) {
      try {
        const editsContent = editsMatch[1].trim();
        // Find the JSON object within the edits section
        const jsonMatch = editsContent.match(/\{[\s\S]*\}/);
        
        if (jsonMatch) {
          editsJson = JSON.parse(jsonMatch[0]);
          console.log('Successfully parsed edits JSON');
          
          // Apply the edits to the content and get details of applied edits
          const { content: transformedContent, appliedEdits } = applyEdits(contentToEdit, editsJson);
          editedContent = transformedContent;
          console.log(`Generated edited content: ${editedContent.length} characters`);
          console.log(`Applied ${appliedEdits.length} individual edits`);
          
          // Store each individual edit in the content_edits table
          if (appliedEdits.length > 0) {
            const contentEditsData = appliedEdits.map(edit => ({
              job_id: job_id,
              document_id: editJob.document_id,
              edit_type: 'style',
              paragraph_number: edit.paragraph_number,
              original_text: edit.original_text,
              edited_text: edit.edited_text,
              reasoning: edit.reasoning
            }));
            
            const { data: storedEdits, error: editsStoreError } = await supabase
              .from('content_edits')
              .insert(contentEditsData)
              .select('id');
            
            if (editsStoreError) {
              console.error('Error storing content edits:', editsStoreError);
            } else {
              console.log(`Stored ${storedEdits.length} content edits`);
            }
          }
        } else {
          console.error('Could not find JSON object in edits');
          editsJson = { error: 'Could not find JSON object in edits' };
        }
      } catch (jsonError) {
        console.error('Error parsing edits JSON:', jsonError);
        editsJson = { error: `Error parsing edits JSON: ${jsonError.message}` };
      }
    }
    
    if (continueMatch && continueMatch[1]) {
      continueProcessing = continueMatch[1].trim().toLowerCase() === 'true';
      console.log(`Continue processing: ${continueProcessing}`);
    }
    
    // Store thinking in the thinking_logs table
    if (thinking) {
      await supabase
        .from('thinking_logs')
        .insert({
          job_id: job_id,
          thinking: thinking,
          prompt_type: 'style',
          insight_tags: extractInsightTags(thinking)
        });
    }
    
    // Update the edit job with the results
    await supabase
      .from('edit_jobs')
      .update({ 
        status: continueProcessing ? 'processing' : 'completed',
        edited_content: editedContent || null,
        analysis: analysisText || null,
        thinking: thinking || null,
        completed_at: continueProcessing ? null : new Date().toISOString()
      })
      .eq('id', job_id);
    
    // If there's edited content, create a document version
    if (editedContent) {
      const { data: versionData, error: versionError } = await supabase
        .from('document_versions')
        .insert({
          job_id: job_id,
          content: editedContent,
          thinking: thinking || null,
          description: 'Style transformation'
        })
        .select()
        .single();
      
      if (versionError) {
        console.error('Error creating document version:', versionError);
      } else {
        console.log(`Created document version with ID: ${versionData.id}`);
        
        // Link the edits to this version
        const { data: contentEdits, error: editsQueryError } = await supabase
          .from('content_edits')
          .select('id')
          .eq('job_id', job_id)
          .eq('edit_type', 'style')
          .eq('is_deleted', false)
          .eq('is_applied', false);
          
        if (editsQueryError) {
          console.error('Error fetching content edits:', editsQueryError);
        } else if (contentEdits && contentEdits.length > 0) {
          // Create applied_edits entries for all edits
          const appliedEditsData = contentEdits.map(edit => ({
            version_id: versionData.id,
            edit_id: edit.id
          }));
          
          const { data: appliedEdits, error: appliedEditsError } = await supabase
            .from('applied_edits')
            .insert(appliedEditsData)
            .select();
          
          if (appliedEditsError) {
            console.error('Error recording applied edits:', appliedEditsError);
          } else {
            console.log(`Recorded ${appliedEdits.length} applied edits for version ${versionData.id}`);
          }
        }
      }
    }
    
    // If we need to continue processing (for large documents), trigger the second chunk
    if (continueProcessing) {
      console.log('Document needs further processing, will continue with next chunk');
      
      // Here you would implement chunking logic for large documents
      // For now, we'll just mark it as completed
      
      await supabase
        .from('edit_jobs')
        .update({ 
          status: 'completed',
          completed_at: new Date().toISOString()
        })
        .eq('id', job_id);
    } else {
      // If processing is complete and we have a result, move to redundancy removal
      if (editedContent) {
        console.log('Style transformation complete, triggering redundancy removal');
        
        // Call the process-redundancy-removal function
        fetch(`${supabaseUrl}/functions/v1/process-redundancy-removal`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            job_id: job_id
          })
        }).catch(error => {
          console.error('Error triggering redundancy removal:', error);
        });
      }
    }
    
    // Return success response
    return new Response(JSON.stringify({ 
      success: true,
      job_id: job_id,
      status: continueProcessing ? 'processing' : 'completed',
      has_edited_content: !!editedContent
    }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });
  } catch (error) {
    console.error('Error in process-style-transformation function:', error);
    
    return new Response(
      JSON.stringify({ 
        error: `Failed to process style transformation: ${error.message}` 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    );
  }
});

// Function to generate the style transformation prompt
function generateStylePrompt(styleGuide, content) {
  return `You are a specialized content editor focused on targeted rewrites. Your task is to analyze and rewrite the following markdown content
according to the style guide while preserving required elements and structure.

STYLE GUIDE:
Client Info:
- Name: ${styleGuide.clientInfo.name}
- Domain: ${styleGuide.clientInfo.domain}
- Brand Values: ${styleGuide.clientInfo.brandValues?.join(", ") || "N/A"}

Voice and Tone:
- Voice: ${styleGuide.voice.prompt}
- Tone Characteristics: ${styleGuide.voice.tone.join(", ")}
- Key Traits: ${styleGuide.voice.traits.join(", ")}
- Language Style: ${styleGuide.voice.languageStyle || "N/A"}
- Linguistic Style: ${styleGuide.voice.linguisticStyle || "N/A"}

Content Guidelines:
- Preferred Formats: ${styleGuide.content.preferredFormats?.join(", ") || "N/A"}
- Frequent Phrases: ${styleGuide.voice.frequentPhrases.join(", ")}
- Trademark Terms: ${styleGuide.content.trademarkWords.join(", ")}
- Topics to Avoid: ${styleGuide.content.avoidTopics.join(", ")}

Competitors to Avoid:
- Names: ${styleGuide.competitors?.names.join(", ") || "N/A"}
- Domains: ${styleGuide.competitors?.domains.join(", ") || "N/A"}

CONTENT TO ANALYZE:
${content}

IMPORTANT: YOU MUST PROVIDE EDITS FOR THE FULL DOCUMENT

First, think through the editing process step by step. For each paragraph:
1. Analyze how well it aligns with the style guide
2. Identify specific aspects that need modification
3. Consider how to rewrite while preserving meaning
4. Formulate specific edits with clear replacements

Place your detailed thought process in <thinking> tags.

If the complete document is not edited, provide a continue value of true.
If you have edited the complete document, provide a continue value of false.

Please provide your detailed analysis and suggested edits in the following format:

<thinking>
[Your detailed step-by-step reasoning about each paragraph, including:
- Analysis of current voice and tone
- Evaluation against style guide requirements
- Consideration of alternative phrasings
- Reasoning for each edit decision
- Any concerns or tradeoffs you considered]
</thinking>

<analysis>
[Your detailed paragraph-by-paragraph analysis here]
</analysis>

<edits>
{
  "document": {
    "paragraphs": [
      {
        "number": [paragraph number],
        "analysis": "[brief analysis explaining alignment with style guide]",
        "edits": [
          {
            "find": "[original text]",
            "replace": "[new text aligned with style guide]",
            "reasoning": "[brief explanation of why this edit improves alignment with style guide]"
          }
        ]
      }
    ]
  }
}
</edits>

<continue>
[true or false]
</continue>`;
}

// Function to apply edits to the content and return details about the applied edits
function applyEdits(originalContent, editsJson) {
  try {
    if (!editsJson || !editsJson.document || !editsJson.document.paragraphs) {
      console.error('Invalid edits JSON structure');
      return { 
        content: originalContent,
        appliedEdits: []
      };
    }
    
    let content = originalContent;
    const appliedEdits = [];
    
    // Sort paragraphs by number to ensure we process them in order
    const sortedParagraphs = [...editsJson.document.paragraphs].sort((a, b) => a.number - b.number);
    
    for (const paragraph of sortedParagraphs) {
      if (paragraph.edits && Array.isArray(paragraph.edits)) {
        for (const edit of paragraph.edits) {
          if (edit.find && edit.replace !== undefined) {
            // Check if the find text exists in the content
            if (content.includes(edit.find)) {
              // Replace the content
              content = content.replace(edit.find, edit.replace);
              
              // Record the applied edit
              appliedEdits.push({
                paragraph_number: paragraph.number,
                original_text: edit.find,
                edited_text: edit.replace,
                reasoning: edit.reasoning || paragraph.analysis || 'Style transformation',
                edit_type: 'style'
              });
            } else {
              console.log(`Original text not found for edit in paragraph ${paragraph.number}`);
            }
          }
        }
      }
    }
    
    return { 
      content, 
      appliedEdits 
    };
  } catch (error) {
    console.error('Error applying edits:', error);
    return { 
      content: originalContent,
      appliedEdits: []
    };
  }
}

// Function to extract insight tags from thinking
function extractInsightTags(thinking) {
  // Extract key phrases that might be useful for categorization
  const potentialTags = [];
  
  // Look for mentions of tone
  const toneMatches = thinking.match(/tone is ([\w\s,]+)/gi);
  if (toneMatches) {
    for (const match of toneMatches) {
      const tone = match.replace(/tone is /i, '').trim();
      if (tone) potentialTags.push(`tone:${tone}`);
    }
  }
  
  // Look for mentions of voice
  const voiceMatches = thinking.match(/voice is ([\w\s,]+)/gi);
  if (voiceMatches) {
    for (const match of voiceMatches) {
      const voice = match.replace(/voice is /i, '').trim();
      if (voice) potentialTags.push(`voice:${voice}`);
    }
  }
  
  // Look for mentions of style
  const styleMatches = thinking.match(/style is ([\w\s,]+)/gi);
  if (styleMatches) {
    for (const match of styleMatches) {
      const style = match.replace(/style is /i, '').trim();
      if (style) potentialTags.push(`style:${style}`);
    }
  }
  
  // Add some generic categories based on thinking content
  if (thinking.includes('passive voice')) potentialTags.push('passive_voice');
  if (thinking.includes('active voice')) potentialTags.push('active_voice');
  if (thinking.includes('formal')) potentialTags.push('formal');
  if (thinking.includes('informal')) potentialTags.push('informal');
  if (thinking.includes('technical')) potentialTags.push('technical');
  if (thinking.includes('jargon')) potentialTags.push('jargon');
  if (thinking.includes('simplify')) potentialTags.push('simplify');
  
  return potentialTags.slice(0, 10); // Limit to 10 tags
}