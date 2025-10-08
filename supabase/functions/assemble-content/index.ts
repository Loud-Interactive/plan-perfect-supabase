// Supabase Edge Function: assemble-content
// Assembles all section content into a complete article

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../helpers.ts';
import { 
  handleError, 
  createResponse,
  updateHeartbeat,
  getOutlineByGuid,
  getAllCompletedSections,
  formatMarkdownContent
} from '../content-perfect/utils/index.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Create Supabase client
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Parse request body
    const requestData = await req.json();
    const { job_id } = requestData;
    
    if (!job_id) {
      return new Response(
        JSON.stringify(createResponse(false, 'Missing required parameter: job_id')),
        { headers: { ...corsHeaders }, status: 400 }
      );
    }

    // Update job heartbeat
    await updateHeartbeat(supabase, job_id);

    // Get job details
    const { data: job, error: jobError } = await supabase
      .from('content_generation_jobs')
      .select('*')
      .eq('id', job_id)
      .eq('is_deleted', false)
      .single();
    
    if (jobError) {
      await handleError(supabase, jobError, { job_id });
      return new Response(
        JSON.stringify(createResponse(false, 'Job not found')),
        { headers: { ...corsHeaders }, status: 404 }
      );
    }

    // Verify job status is 'assembling'
    if (job.status !== 'assembling') {
      return new Response(
        JSON.stringify(createResponse(false, `Invalid job status: ${job.status}. Expected 'assembling'`)),
        { headers: { ...corsHeaders }, status: 400 }
      );
    }

    // Get outline data
    const outline = await getOutlineByGuid(supabase, job.outline_guid);
    if (!outline) {
      await handleError(supabase, 'Outline not found', { job_id, outline_guid: job.outline_guid });
      return new Response(
        JSON.stringify(createResponse(false, 'Outline not found')),
        { headers: { ...corsHeaders }, status: 404 }
      );
    }

    // Parse outline
    let outlineJSON;
    try {
      outlineJSON = JSON.parse(outline.outline);
    } catch (error) {
      await handleError(supabase, 'Invalid outline format', { job_id, outline_guid: job.outline_guid });
      return new Response(
        JSON.stringify(createResponse(false, 'Invalid outline format')),
        { headers: { ...corsHeaders }, status: 400 }
      );
    }

    // Get all completed sections
    const completedSections = await getAllCompletedSections(supabase, job_id);
    
    if (completedSections.length === 0) {
      await handleError(supabase, 'No completed sections found', { job_id });
      return new Response(
        JSON.stringify(createResponse(false, 'No completed sections found')),
        { headers: { ...corsHeaders }, status: 404 }
      );
    }

    // Verify all sections are present
    const { data: allSections, error: allSectionsError } = await supabase
      .from('content_sections')
      .select('section_index')
      .eq('job_id', job_id)
      .eq('is_deleted', false);
    
    if (allSectionsError) {
      await handleError(supabase, allSectionsError, { job_id });
      return new Response(
        JSON.stringify(createResponse(false, 'Failed to retrieve all sections')),
        { headers: { ...corsHeaders }, status: 500 }
      );
    }

    if (completedSections.length !== allSections.length) {
      await handleError(supabase, 'Not all sections are completed', { 
        job_id,
        completed: completedSections.length,
        total: allSections.length
      });
      return new Response(
        JSON.stringify(createResponse(false, 'Not all sections are completed')),
        { headers: { ...corsHeaders }, status: 400 }
      );
    }

    // Assemble the content
    const markdownContent = formatMarkdownContent(completedSections, outlineJSON.title);

    // Store the assembled content
    const { data: existingContent, error: existingError } = await supabase
      .from('generated_content')
      .select('id')
      .eq('job_id', job_id)
      .eq('is_deleted', false);
    
    if (existingError) {
      await handleError(supabase, existingError, { job_id });
      return new Response(
        JSON.stringify(createResponse(false, 'Failed to check for existing content')),
        { headers: { ...corsHeaders }, status: 500 }
      );
    }

    let contentId;
    if (existingContent && existingContent.length > 0) {
      // Update existing content
      const { data: updatedContent, error: updateError } = await supabase
        .from('generated_content')
        .update({
          markdown_content: markdownContent,
          updated_at: new Date().toISOString()
        })
        .eq('id', existingContent[0].id)
        .select('id')
        .single();
      
      if (updateError) {
        await handleError(supabase, updateError, { job_id, content_id: existingContent[0].id });
        return new Response(
          JSON.stringify(createResponse(false, 'Failed to update generated content')),
          { headers: { ...corsHeaders }, status: 500 }
        );
      }
      
      contentId = updatedContent.id;
    } else {
      // Create new content record
      const { data: newContent, error: insertError } = await supabase
        .from('generated_content')
        .insert({
          job_id: job_id,
          outline_guid: job.outline_guid,
          markdown_content: markdownContent,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select('id')
        .single();
      
      if (insertError) {
        await handleError(supabase, insertError, { job_id });
        return new Response(
          JSON.stringify(createResponse(false, 'Failed to create generated content record')),
          { headers: { ...corsHeaders }, status: 500 }
        );
      }
      
      contentId = newContent.id;
    }

    // Update job status to converting
    const { error: jobUpdateError } = await supabase
      .from('content_generation_jobs')
      .update({ 
        status: 'converting',
        updated_at: new Date().toISOString(),
        heartbeat: new Date().toISOString()
      })
      .eq('id', job_id);
    
    if (jobUpdateError) {
      await handleError(supabase, jobUpdateError, { job_id });
      return new Response(
        JSON.stringify(createResponse(false, 'Failed to update job status')),
        { headers: { ...corsHeaders }, status: 500 }
      );
    }

    // Trigger HTML conversion
    try {
      fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/convert-to-html`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`
        },
        body: JSON.stringify({ job_id })
      })
      .catch(error => {
        console.error('Error triggering convert-to-html:', error);
      });
    } catch (error) {
      console.error('Exception when triggering convert-to-html:', error);
    }

    return new Response(
      JSON.stringify(createResponse(true, 'Content assembled successfully', {
        job_id,
        content_id: contentId,
        outline_guid: job.outline_guid,
        sections_count: completedSections.length,
        content_length: markdownContent.length
      })),
      { headers: { ...corsHeaders } }
    );

  } catch (error) {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    await handleError(supabase, error, { path: 'assemble-content' });
    
    return new Response(
      JSON.stringify(createResponse(false, 'Internal server error')),
      { headers: { ...corsHeaders }, status: 500 }
    );
  }
});