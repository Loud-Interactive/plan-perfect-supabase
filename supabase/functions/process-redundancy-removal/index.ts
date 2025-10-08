// supabase/functions/process-redundancy-removal/index.ts
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
    
    console.log(`Processing redundancy removal for job ID: ${job_id}`)
    
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
    
    // Check if we have edited content to work with
    if (!editJob.edited_content) {
      console.error('Edit job has no edited content');
      return new Response(JSON.stringify({ 
        error: 'Edit job has no edited content to process for redundancy removal' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    // Update job status to indicate redundancy processing
    await supabase
      .from('edit_jobs')
      .update({ status: 'processing_redundancy' })
      .eq('id', job_id);
    
    // Initialize Anthropic client
    const anthropic = new Anthropic({
      apiKey: Deno.env.get('ANTHROPIC_API_KEY') || '',
    });
    
    // Prepare the prompt for redundancy removal
    const contentToEdit = editJob.edited_content;
    
    const promptText = generateRedundancyPrompt(contentToEdit);
    
    console.log('Generating redundancy removal with Claude using streaming...');
    
    // Generate the redundancy removal with Claude using streaming
    let thinking = null;
    let textContent = '';
    let processedContent = '';
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
      
      console.log('Redundancy removal complete');
      console.log(`Response length: ${textContent.length} characters`);
    } catch (streamError) {
      console.error('Error during streaming:', streamError);
      
      // Update job status to failed
      await supabase
        .from('edit_jobs')
        .update({ 
          status: 'failed',
          error: `Error during redundancy removal: ${streamError.message}`
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
          processedContent = transformedContent;
          console.log(`Generated processed content: ${processedContent.length} characters`);
          console.log(`Applied ${appliedEdits.length} individual redundancy edits`);
          
          // Store each individual edit in the content_edits table
          if (appliedEdits.length > 0) {
            const contentEditsData = appliedEdits.map(edit => ({
              job_id: job_id,
              document_id: editJob.document_id,
              edit_type: 'redundancy',
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
              console.log(`Stored ${storedEdits.length} redundancy content edits`);
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
          prompt_type: 'redundancy',
          insight_tags: extractInsightTags(thinking)
        });
    }
    
    // Update the edit job with the results
    await supabase
      .from('edit_jobs')
      .update({ 
        status: 'completed',
        edited_content: processedContent || editJob.edited_content,
        analysis: editJob.analysis ? `${editJob.analysis}\n\nRedundancy Analysis:\n${analysisText || 'No redundancy analysis available'}` : analysisText,
        completed_at: new Date().toISOString()
      })
      .eq('id', job_id);
    
    // If there's processed content, create a new document version
    if (processedContent) {
      const { data: versionData, error: versionError } = await supabase
        .from('document_versions')
        .insert({
          job_id: job_id,
          content: processedContent,
          thinking: thinking || null,
          description: 'Redundancy removal'
        })
        .select()
        .single();
      
      if (versionError) {
        console.error('Error creating document version:', versionError);
      } else {
        console.log(`Created document version with ID: ${versionData.id}`);
        
        // Link the redundancy edits to this version
        const { data: contentEdits, error: editsQueryError } = await supabase
          .from('content_edits')
          .select('id')
          .eq('job_id', job_id)
          .eq('edit_type', 'redundancy')
          .eq('is_deleted', false)
          .eq('is_applied', false);
          
        if (editsQueryError) {
          console.error('Error fetching redundancy edits:', editsQueryError);
        } else if (contentEdits && contentEdits.length > 0) {
          // Create applied_edits entries for all redundancy edits
          const appliedEditsData = contentEdits.map(edit => ({
            version_id: versionData.id,
            edit_id: edit.id
          }));
          
          const { data: appliedEdits, error: appliedEditsError } = await supabase
            .from('applied_edits')
            .insert(appliedEditsData)
            .select();
          
          if (appliedEditsError) {
            console.error('Error recording applied redundancy edits:', appliedEditsError);
          } else {
            console.log(`Recorded ${appliedEdits.length} applied redundancy edits for version ${versionData.id}`);
          }
        }
      }
      
      // Update the document with the final processed content
      await supabase
        .from('documents')
        .update({ 
          content: processedContent 
        })
        .eq('id', editJob.document_id);
    }
    
    // Return success response
    return new Response(JSON.stringify({ 
      success: true,
      job_id: job_id,
      status: 'completed',
      has_processed_content: !!processedContent
    }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });
  } catch (error) {
    console.error('Error in process-redundancy-removal function:', error);
    
    return new Response(
      JSON.stringify({ 
        error: `Failed to process redundancy removal: ${error.message}` 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    );
  }
});

// Function to generate the redundancy removal prompt
function generateRedundancyPrompt(editedContent) {
  return `You are a specialized content editor focusing exclusively on removing unnecessary repetition and redundancy.
Your task is to analyze the following content and eliminate any redundant phrases, sentences, or paragraphs while preserving meaning.

ANALYSIS INSTRUCTIONS:
1. Read through the content carefully, paragraph by paragraph
2. For each paragraph:
   - Identify redundant information and repeated concepts
   - Look for opportunities to combine or condense similar ideas
   - Ensure all essential information is preserved
   - Make sure any text to be replaced is unique within the document

3. Your analysis should focus on:
   - Unnecessary repetition of ideas
   - Duplicate information across paragraphs
   - Overlapping concepts that can be combined
   - Opportunities for more concise expression
   - Maintaining the original style and tone

4. For each edit:
   - Provide clear reasoning about the redundancy
   - Ensure the replacement text is more concise
   - Maintain the original meaning and style
   - Use callback techniques where appropriate
   - Preserve all citations and key information

CONTENT TO ANALYZE:
${editedContent}

IMPORTANT: YOU MUST PROVIDE EDITS FOR THE FULL DOCUMENT

Think through your editing process carefully, analyzing each paragraph for redundancy. Consider cross-paragraph repetition as well as redundancy within paragraphs. 

For each potential edit, explicitly evaluate:
- Is this truly redundant, or does the repetition serve a purpose?
- Does my edit preserve all essential meaning?
- Is my replacement text more concise without losing clarity?
- Does my edit maintain the original style and tone?

Place your detailed thought process in <thinking> tags.

If the complete document is not analyzed, provide a continue value of true.
If you have analyzed the complete document, provide a continue value of false.

Please provide your analysis and suggested edits in the following format:

<thinking>
[Your detailed step-by-step reasoning about redundancy in each paragraph, including:
- Identification of specific redundant elements
- Analysis of whether repetition serves a purpose
- Consideration of how to condense while preserving meaning
- Reasoning for each edit decision
- Cross-paragraph redundancy analysis]
</thinking>

<analysis>
[Your detailed paragraph-by-paragraph analysis of redundancy and repetition]
</analysis>

<edits>
{
  "document": {
    "paragraphs": [
      {
        "number": [paragraph number],
        "analysis": "[brief explanation of redundancy found]",
        "edits": [
          {
            "find": "[redundant text to remove/condense]",
            "replace": "[condensed or combined text]",
            "reasoning": "[brief explanation of why this edit improves conciseness]"
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
                reasoning: edit.reasoning || paragraph.analysis || 'Redundancy removal',
                edit_type: 'redundancy'
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
  
  // Look for mentions of redundancy
  const redundancyMatches = thinking.match(/redundant ([\w\s,]+)/gi);
  if (redundancyMatches) {
    for (const match of redundancyMatches) {
      const redundancy = match.replace(/redundant /i, '').trim();
      if (redundancy) potentialTags.push(`redundancy:${redundancy}`);
    }
  }
  
  // Look for mentions of repetition
  const repetitionMatches = thinking.match(/repetition of ([\w\s,]+)/gi);
  if (repetitionMatches) {
    for (const match of repetitionMatches) {
      const repetition = match.replace(/repetition of /i, '').trim();
      if (repetition) potentialTags.push(`repetition:${repetition}`);
    }
  }
  
  // Add some generic categories based on thinking content
  if (thinking.includes('duplicate information')) potentialTags.push('duplicate_info');
  if (thinking.includes('rephrase')) potentialTags.push('rephrase');
  if (thinking.includes('combine')) potentialTags.push('combine_paragraphs');
  if (thinking.includes('condense')) potentialTags.push('condense');
  if (thinking.includes('overlapping')) potentialTags.push('overlapping_concepts');
  if (thinking.includes('wordiness')) potentialTags.push('wordiness');
  if (thinking.includes('repetitive structure')) potentialTags.push('repetitive_structure');
  
  return potentialTags.slice(0, 10); // Limit to 10 tags
}