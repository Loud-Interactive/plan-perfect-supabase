// Supabase Edge Function: create-content-job
// Creates a new content generation job from an outline GUID

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../helpers.ts';
import { 
  handleError, 
  createResponse, 
  getOutlineByGuid, 
  parseOutline,
  updateHeartbeat
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
    const { outline_guid } = requestData;
    
    if (!outline_guid) {
      return new Response(
        JSON.stringify(createResponse(false, 'Missing required parameter: outline_guid')),
        { headers: { ...corsHeaders }, status: 400 }
      );
    }

    // Verify outline exists and get outline data
    const outline = await getOutlineByGuid(supabase, outline_guid);
    if (!outline) {
      return new Response(
        JSON.stringify(createResponse(false, 'Outline not found')),
        { headers: { ...corsHeaders }, status: 404 }
      );
    }

    // Check if a content generation job already exists for this outline
    const { data: existingJobs, error: checkError } = await supabase
      .from('content_generation_jobs')
      .select('id, status')
      .eq('outline_guid', outline_guid)
      .eq('is_deleted', false);
    
    if (checkError) {
      await handleError(supabase, checkError, { outline_guid });
      return new Response(
        JSON.stringify(createResponse(false, 'Error checking for existing jobs')),
        { headers: { ...corsHeaders }, status: 500 }
      );
    }

    // If there's an existing job that's not failed, return it
    const activeJob = existingJobs?.find(job => job.status !== 'failed');
    if (activeJob) {
      return new Response(
        JSON.stringify(createResponse(true, 'Existing job found', { job_id: activeJob.id, status: activeJob.status })),
        { headers: { ...corsHeaders } }
      );
    }

    // Parse the outline to validate format and extract sections
    let parsedOutline;
    try {
      parsedOutline = parseOutline(outline.outline);
    } catch (error) {
      await handleError(supabase, error, { outline_guid });
      return new Response(
        JSON.stringify(createResponse(false, 'Invalid outline format')),
        { headers: { ...corsHeaders }, status: 400 }
      );
    }

    // Create a new content generation job
    const { data: job, error: jobError } = await supabase
      .from('content_generation_jobs')
      .insert({
        outline_guid: outline_guid,
        status: 'pending',
        progress: { completed: 0, total: parsedOutline.sections.length },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        heartbeat: new Date().toISOString()
      })
      .select()
      .single();
    
    if (jobError) {
      await handleError(supabase, jobError, { outline_guid });
      return new Response(
        JSON.stringify(createResponse(false, 'Failed to create job')),
        { headers: { ...corsHeaders }, status: 500 }
      );
    }

    // Create section entries for each section in the outline
    const sections = [];
    for (let i = 0; i < parsedOutline.sections.length; i++) {
      const section = parsedOutline.sections[i];
      
      let sectionType = 'heading';
      if (i === 0 && section.title.toLowerCase().includes('introduction')) {
        sectionType = 'introduction';
      } else if (i === parsedOutline.sections.length - 1 && section.title.toLowerCase().includes('conclusion')) {
        sectionType = 'conclusion';
      }
      
      sections.push({
        job_id: job.id,
        section_index: i,
        section_title: section.title,
        section_type: sectionType,
        status: 'pending',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    }

    // Batch insert all sections
    const { error: sectionsError } = await supabase
      .from('content_sections')
      .insert(sections);
    
    if (sectionsError) {
      await handleError(supabase, sectionsError, { job_id: job.id, outline_guid });
      
      // Clean up the job if section creation fails
      await supabase
        .from('content_generation_jobs')
        .update({ status: 'failed', error: 'Failed to create section entries' })
        .eq('id', job.id);
      
      return new Response(
        JSON.stringify(createResponse(false, 'Failed to create section entries')),
        { headers: { ...corsHeaders }, status: 500 }
      );
    }

    // Create section queue entries for each section
    const queueEntries = sections.map(section => ({
      job_id: job.id,
      section_index: section.section_index,
      status: 'pending',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      next_attempt_at: new Date().toISOString()
    }));

    const { error: queueError } = await supabase
      .from('content_section_queue')
      .insert(queueEntries);
    
    if (queueError) {
      await handleError(supabase, queueError, { job_id: job.id, outline_guid });
      
      // Don't fail the job here since the sections are created successfully
      // The process-content-job will handle the retry
      console.error('Failed to create queue entries, will retry during processing');
    }

    // Update job status to research
    await supabase
      .from('content_generation_jobs')
      .update({ status: 'research' })
      .eq('id', job.id);

    // Trigger the process-content-job function asynchronously
    try {
      fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/process-content-job`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`
        },
        body: JSON.stringify({ job_id: job.id })
      })
      .catch(error => {
        console.error('Error triggering process-content-job:', error);
      });
    } catch (error) {
      console.error('Exception when triggering process-content-job:', error);
      // The cron job will pick this up eventually, so we don't fail the whole operation
    }

    return new Response(
      JSON.stringify(createResponse(true, 'Content generation job created successfully', {
        job_id: job.id,
        status: 'research',
        outline_guid: outline_guid,
        created_at: job.created_at
      })),
      { headers: { ...corsHeaders } }
    );

  } catch (error) {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    await handleError(supabase, error, { path: 'create-content-job' });
    
    return new Response(
      JSON.stringify(createResponse(false, 'Internal server error')),
      { headers: { ...corsHeaders }, status: 500 }
    );
  }
});