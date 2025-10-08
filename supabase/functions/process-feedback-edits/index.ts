// supabase/functions/process-feedback-edits/index.ts
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
    const { job_id, feedback } = await req.json()
    
    if (!job_id) {
      return new Response(JSON.stringify({ error: 'Job ID is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    if (!feedback || typeof feedback !== 'string' || feedback.trim() === '') {
      return new Response(JSON.stringify({ error: 'Feedback is required and must be a non-empty string' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    console.log(`Processing feedback edits for job ID: ${job_id}`)
    
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
    
    // Get the latest version of the document content
    const { data: latestVersion, error: versionError } = await supabase
      .from('document_versions')
      .select('*')
      .eq('job_id', job_id)
      .eq('is_deleted', false)
      .order('timestamp', { ascending: false })
      .limit(1)
      .single();
    
    // Determine which content to use for the feedback
    const contentToEdit = latestVersion?.content || editJob.edited_content || editJob.original_content;
    
    if (!contentToEdit) {
      console.error('No content available to edit');
      return new Response(JSON.stringify({ 
        error: 'No content available to edit' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    // Initialize Anthropic client
    const anthropic = new Anthropic({
      apiKey: Deno.env.get('ANTHROPIC_API_KEY') || '',
    });
    
    // Prepare the prompt for feedback-based editing
    const promptText = generateFeedbackPrompt(contentToEdit, feedback);
    
    console.log('Generating feedback-based edits with Claude using streaming...');
    
    // Generate the feedback-based edits with Claude using streaming
    let thinking = null;
    let textContent = '';
    let analysisText = '';
    let improvementSuggestions = '';
    let conclusion = '';
    
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
      
      console.log('Feedback-based edits generation complete');
      console.log(`Response length: ${textContent.length} characters`);
    } catch (streamError) {
      console.error('Error during streaming:', streamError);
      throw new Error(`Error during streaming response: ${streamError.message}`);
    }
    
    // Parse the response
    const thinkingMatch = textContent.match(/<thinking>([\s\S]*?)<\/thinking>/i);
    const editsMatch = textContent.match(/<edits>([\s\S]*?)<\/edits>/i);
    
    if (thinkingMatch && thinkingMatch[1]) {
      if (!thinking) {  // Only use this if we didn't get thinking from the stream
        thinking = thinkingMatch[1].trim();
      }
      console.log(`Extracted thinking content from text: ${thinking.length} characters`);
    }
    
    if (editsMatch && editsMatch[1]) {
      const editsContent = editsMatch[1].trim();
      
      // Extract analysis, improvement suggestions, and conclusion
      const analysisMatch = editsContent.match(/<analysis>([\s\S]*?)<\/analysis>/i);
      const improvementSuggestionsMatch = editsContent.match(/<improvement_suggestions>([\s\S]*?)<\/improvement_suggestions>/i);
      const conclusionMatch = editsContent.match(/<conclusion>([\s\S]*?)<\/conclusion>/i);
      
      if (analysisMatch && analysisMatch[1]) {
        analysisText = analysisMatch[1].trim();
        console.log(`Extracted analysis: ${analysisText.length} characters`);
      }
      
      if (improvementSuggestionsMatch && improvementSuggestionsMatch[1]) {
        improvementSuggestions = improvementSuggestionsMatch[1].trim();
        console.log(`Extracted improvement suggestions: ${improvementSuggestions.length} characters`);
      }
      
      if (conclusionMatch && conclusionMatch[1]) {
        conclusion = conclusionMatch[1].trim();
        console.log(`Extracted conclusion: ${conclusion.length} characters`);
      }
    }
    
    // Store thinking in the thinking_logs table
    if (thinking) {
      await supabase
        .from('thinking_logs')
        .insert({
          job_id: job_id,
          thinking: thinking,
          prompt_type: 'feedback',
          insight_tags: extractInsightTags(thinking)
        });
    }
    
    // Create suggested changes based on the improvement suggestions
    const suggestedChanges = extractSuggestedChanges(improvementSuggestions);
    
    // Create a new document version with the feedback
    const { data: versionData, error: versionError2 } = await supabase
      .from('document_versions')
      .insert({
        job_id: job_id,
        content: contentToEdit, // Keep the same content, changes will be suggested
        feedback: feedback,
        thinking: thinking || null,
        description: `Feedback: ${feedback.substring(0, 50)}${feedback.length > 50 ? '...' : ''}`
      })
      .select()
      .single();
    
    if (versionError2) {
      console.error('Error creating document version:', versionError2);
      return new Response(JSON.stringify({ 
        error: `Failed to create document version: ${versionError2.message}` 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    console.log(`Created document version with ID: ${versionData.id}`);
    
    // Store suggested changes in both the legacy table and the new content_edits table
    if (suggestedChanges.length > 0) {
      // Legacy storage in suggested_changes
      const suggestedChangesData = suggestedChanges.map(change => ({
        version_id: versionData.id,
        original: change.original || '',
        suggested: change.suggested || '',
        reasoning: change.reasoning || ''
      }));
      
      const { data: changesData, error: changesError } = await supabase
        .from('suggested_changes')
        .insert(suggestedChangesData)
        .select();
      
      if (changesError) {
        console.error('Error storing suggested changes:', changesError);
      } else {
        console.log(`Stored ${changesData.length} suggested changes in legacy table`);
      }
      
      // New storage in content_edits
      const contentEditsData = suggestedChanges.map(change => ({
        job_id: job_id,
        document_id: editJob.documents.id,
        version_id: versionData.id,
        edit_type: 'feedback',
        original_text: change.original || '',
        edited_text: change.suggested || '',
        reasoning: change.reasoning || '',
        is_applied: false // These are suggestions until approved
      }));
      
      const { data: editsData, error: editsError } = await supabase
        .from('content_edits')
        .insert(contentEditsData)
        .select('id');
      
      if (editsError) {
        console.error('Error storing content edits:', editsError);
      } else {
        console.log(`Stored ${editsData.length} content edits`);
      }
    }
    
    // Create an edit analysis record
    await supabase
      .from('edit_analyses')
      .insert({
        job_id: job_id,
        diff_summary: analysisText || null,
        new_edit_prompt: conclusion || null,
        thinking_analysis: thinking ? `Analysis of thinking process related to feedback: "${feedback}"` : null
      });
    
    // Return success response
    return new Response(JSON.stringify({ 
      success: true,
      job_id: job_id,
      version_id: versionData.id,
      analysis: analysisText || null,
      improvement_suggestions: improvementSuggestions || null,
      conclusion: conclusion || null,
      suggested_changes: suggestedChanges.length
    }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });
  } catch (error) {
    console.error('Error in process-feedback-edits function:', error);
    
    return new Response(
      JSON.stringify({ 
        error: `Failed to process feedback edits: ${error.message}` 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    );
  }
});

// Function to generate the feedback-based editing prompt
function generateFeedbackPrompt(content, userFeedback) {
  return `You are an AI assistant tasked with analyzing content and suggesting improvements based on user feedback. Your goal is to understand the user's concerns, critically examine the content, and propose ways to enhance it.

Here is the content to be analyzed:
<content>
${content}
</content>

The user has provided feedback about problems they've identified with the content. Here is their feedback in plain English:
<user_feedback>
${userFeedback}
</user_feedback>

Please follow these steps carefully, thinking through each one:

1. Carefully read and understand both the content and the user's feedback.
2. Analyze the content in light of the user's feedback. Consider aspects such as clarity, structure, tone, accuracy, redundancy and relevance.
3. Identify specific areas where the content can be improved based on the user's feedback and your own analysis.
4. For each area of improvement, think about concrete ways to enhance the content. Consider rewording, restructuring, adding or removing information, or changing the tone or style.
5. Organize your thoughts and suggestions for improvements. For each suggested edit or improvement, include your reasoning.

First, think through your analysis process step by step, considering:
- What is the user's core concern?
- How does the current content fail to address this concern?
- What specific improvements would resolve the issue?
- Are there multiple ways to approach this problem?
- Which approach would best satisfy the user's needs?

Place your detailed thought process in <thinking> tags.

Present your analysis and suggestions in the following format:

<thinking>
[Your detailed step-by-step reasoning process, including:
- Analysis of the user's feedback and its implications
- Identification of specific content issues
- Exploration of multiple potential solutions
- Evaluation of which solutions best address the user's concerns
- Reasoning behind each suggested improvement]
</thinking>

<edits>
<analysis>
[Provide a brief overview of your analysis of the content in light of the user's feedback]
</analysis>

<improvement_suggestions>
1. [First area of improvement]
<edit_prompt>
[Your thoughts on why this improvement is necessary and how it addresses the user's feedback or enhances the content]
</edit_prompt>

2. [Second area of improvement]
<edit_prompt>
[Your thoughts on why this improvement is necessary and how it addresses the user's feedback or enhances the content]
</edit_prompt>

[Continue with additional areas of improvement as needed]
</improvement_suggestions>

<conclusion>
[Provide a brief summary of how these improvements will address the user's concerns and enhance the overall quality of the content]
</conclusion>
</edits>

Remember to be constructive and specific in your suggestions, always keeping the user's feedback in mind while also applying your own analytical skills to improve the content.`;
}

// Function to extract insight tags from thinking
function extractInsightTags(thinking) {
  // Extract key phrases that might be useful for categorization
  const potentialTags = [];
  
  // Look for mentions of specific issues
  const issueMatches = thinking.match(/issue with ([\w\s,]+)/gi);
  if (issueMatches) {
    for (const match of issueMatches) {
      const issue = match.replace(/issue with /i, '').trim();
      if (issue) potentialTags.push(`issue:${issue}`);
    }
  }
  
  // Look for mentions of feedback themes
  const feedbackMatches = thinking.match(/feedback about ([\w\s,]+)/gi);
  if (feedbackMatches) {
    for (const match of feedbackMatches) {
      const feedback = match.replace(/feedback about /i, '').trim();
      if (feedback) potentialTags.push(`feedback:${feedback}`);
    }
  }
  
  // Add some generic categories based on thinking content
  if (thinking.includes('clarity')) potentialTags.push('clarity');
  if (thinking.includes('structure')) potentialTags.push('structure');
  if (thinking.includes('tone')) potentialTags.push('tone');
  if (thinking.includes('accuracy')) potentialTags.push('accuracy');
  if (thinking.includes('redundancy')) potentialTags.push('redundancy');
  if (thinking.includes('relevance')) potentialTags.push('relevance');
  if (thinking.includes('missing information')) potentialTags.push('missing_info');
  
  return potentialTags.slice(0, 10); // Limit to 10 tags
}

// Function to extract suggested changes from improvement suggestions
function extractSuggestedChanges(improvementSuggestions) {
  if (!improvementSuggestions) return [];
  
  const suggestedChanges = [];
  
  // Split by numbered points (e.g., "1. ", "2. ")
  const suggestions = improvementSuggestions.split(/\d+\.\s+/);
  
  // Skip the first split which is usually empty
  for (let i = 1; i < suggestions.length; i++) {
    const suggestion = suggestions[i].trim();
    
    // Extract the edit prompt content
    const editPromptMatch = suggestion.match(/<edit_prompt>([\s\S]*?)<\/edit_prompt>/i);
    
    if (editPromptMatch && editPromptMatch[1]) {
      const reasoning = editPromptMatch[1].trim();
      
      // Get the title of the suggestion (the text before the edit_prompt)
      const title = suggestion.substring(0, suggestion.indexOf('<edit_prompt>')).trim();
      
      suggestedChanges.push({
        original: "", // Can't determine original without specific marked sections
        suggested: title,
        reasoning: reasoning
      });
    } else {
      // If no edit_prompt tags, use the whole suggestion as reasoning
      suggestedChanges.push({
        original: "",
        suggested: suggestion.substring(0, Math.min(100, suggestion.length)) + "...",
        reasoning: suggestion
      });
    }
  }
  
  return suggestedChanges;
}