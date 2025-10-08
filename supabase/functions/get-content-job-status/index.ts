// Supabase Edge Function: get-content-job-status
// Returns detailed status information for a content generation job

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../helpers.ts';
import { 
  handleError, 
  createResponse
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

    // Get job details
    const { data: job, error: jobError } = await supabase
      .from('content_generation_jobs')
      .select('*, generated_content(*)')
      .eq('id', job_id)
      .eq('is_deleted', false)
      .single();
    
    if (jobError) {
      if (jobError.code === 'PGRST116') {
        return new Response(
          JSON.stringify(createResponse(false, 'Job not found')),
          { headers: { ...corsHeaders }, status: 404 }
        );
      }
      
      await handleError(supabase, jobError, { job_id });
      return new Response(
        JSON.stringify(createResponse(false, 'Error retrieving job details')),
        { headers: { ...corsHeaders }, status: 500 }
      );
    }

    // Get all sections for the job
    const { data: sections, error: sectionsError } = await supabase
      .from('content_sections')
      .select('*')
      .eq('job_id', job_id)
      .eq('is_deleted', false)
      .order('section_index', { ascending: true });
    
    if (sectionsError) {
      await handleError(supabase, sectionsError, { job_id });
      return new Response(
        JSON.stringify(createResponse(false, 'Error retrieving section details')),
        { headers: { ...corsHeaders }, status: 500 }
      );
    }

    // Get queue entries for the job
    const { data: queueEntries, error: queueError } = await supabase
      .from('content_section_queue')
      .select('*')
      .eq('job_id', job_id)
      .eq('is_deleted', false)
      .order('section_index', { ascending: true });
    
    if (queueError) {
      await handleError(supabase, queueError, { job_id });
      // Don't fail the request just because queue data isn't available
      console.error('Failed to retrieve queue entries:', queueError.message);
    }

    // Get search and reference data counts
    const { data: searchQueryCounts, error: searchQueryError } = await supabase
      .from('section_search_queries')
      .select('section_id, count(*)')
      .in('section_id', sections.map(s => s.id))
      .eq('is_deleted', false)
      .group('section_id');
    
    if (searchQueryError) {
      console.error('Failed to retrieve search query counts:', searchQueryError.message);
    }

    const { data: searchResultCounts, error: searchResultError } = await supabase
      .from('section_search_results')
      .select('section_id, count(*)')
      .in('section_id', sections.map(s => s.id))
      .eq('is_deleted', false)
      .group('section_id');
    
    if (searchResultError) {
      console.error('Failed to retrieve search result counts:', searchResultError.message);
    }

    // Prepare job status response
    const sectionDetails = sections.map(section => {
      const queueEntry = queueEntries?.find(q => q.section_index === section.section_index) || null;
      const searchQueryCount = searchQueryCounts?.find(q => q.section_id === section.id)?.count || 0;
      const searchResultCount = searchResultCounts?.find(r => r.section_id === section.id)?.count || 0;
      
      return {
        id: section.id,
        index: section.section_index,
        title: section.section_title,
        type: section.section_type,
        status: section.status,
        has_content: !!section.section_content,
        queue_status: queueEntry?.status || null,
        queue_attempts: queueEntry?.attempts || 0,
        search_queries: Number(searchQueryCount),
        search_results: Number(searchResultCount),
        has_references: !!section.references_data,
        updated_at: section.updated_at
      };
    });

    const completedSections = sections.filter(s => s.status === 'completed').length;
    const totalSections = sections.length;

    // Format response
    const response = {
      job_id: job.id,
      outline_guid: job.outline_guid,
      status: job.status,
      progress: {
        completed: completedSections,
        total: totalSections,
        percentage: totalSections > 0 ? Math.round((completedSections / totalSections) * 100) : 0,
        sections: sectionDetails
      },
      has_generated_content: job.generated_content && job.generated_content.length > 0,
      error: job.error || null,
      created_at: job.created_at,
      updated_at: job.updated_at,
      last_heartbeat: job.heartbeat
    };

    return new Response(
      JSON.stringify(createResponse(true, 'Job details retrieved successfully', response)),
      { headers: { ...corsHeaders } }
    );

  } catch (error) {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    await handleError(supabase, error, { path: 'get-content-job-status' });
    
    return new Response(
      JSON.stringify(createResponse(false, 'Internal server error')),
      { headers: { ...corsHeaders }, status: 500 }
    );
  }
});