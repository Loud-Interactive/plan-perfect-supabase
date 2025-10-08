// supabase/functions/get-edit-job-status/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.4.0'

serve(async (req) => {
  // Set CORS headers for all responses
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  }

  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders, status: 204 })
  }

  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  
  try {
    let job_id;
    let content_plan_outline_guid;
    
    // Parse parameters from either GET or POST
    if (req.method === 'GET') {
      const url = new URL(req.url);
      job_id = url.searchParams.get('job_id');
      content_plan_outline_guid = url.searchParams.get('content_plan_outline_guid');
    } else { // POST
      const body = await req.json();
      job_id = body.job_id;
      content_plan_outline_guid = body.content_plan_outline_guid;
    }
    
    // Either job_id or content_plan_outline_guid must be provided
    if (!job_id && !content_plan_outline_guid) {
      return new Response(JSON.stringify({ error: 'Either job_id or content_plan_outline_guid is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    let jobData;
    
    if (job_id) {
      // Get job by id
      console.log(`Getting status for job ID: ${job_id}`);
      
      const { data: jobResult, error: jobError } = await supabase
        .from('edit_jobs')
        .select(`
          *,
          documents:document_id(*),
          versions:document_versions(*)
        `)
        .eq('id', job_id)
        .eq('is_deleted', false)
        .single();
      
      if (jobError) {
        console.error('Error fetching job:', jobError);
        return new Response(JSON.stringify({ 
          error: `Failed to fetch job: ${jobError.message}` 
        }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      jobData = jobResult;
      
    } else {
      // Get most recent job by content_plan_outline_guid
      console.log(`Getting status for outline GUID: ${content_plan_outline_guid}`);
      
      const { data: documentResult, error: documentError } = await supabase
        .from('documents')
        .select(`
          *,
          jobs:edit_jobs(
            *,
            versions:document_versions(*)
          )
        `)
        .eq('content_plan_outline_guid', content_plan_outline_guid)
        .eq('is_deleted', false)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      
      if (documentError) {
        console.error('Error fetching document:', documentError);
        return new Response(JSON.stringify({ 
          error: `Failed to fetch document: ${documentError.message}` 
        }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      // Get the most recent job
      if (documentResult.jobs && documentResult.jobs.length > 0) {
        jobData = {
          ...documentResult.jobs[0],
          documents: documentResult
        };
      } else {
        return new Response(JSON.stringify({ 
          error: `No jobs found for content plan outline GUID: ${content_plan_outline_guid}` 
        }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }
    
    // Get additional data for detailed status information
    let thinkingLogs = [];
    let contentEdits = [];
    let progressDetails = {};
    
    // Get thinking logs for the job
    if (jobData.status !== 'pending') {
      const { data: thinking, error: thinkingError } = await supabase
        .from('thinking_logs')
        .select('*')
        .eq('job_id', jobData.id)
        .eq('is_deleted', false)
        .order('timestamp', { ascending: false });
      
      if (!thinkingError && thinking) {
        thinkingLogs = thinking;
      }
      
      // Get edit counts by type
      const { data: editCounts, error: editCountsError } = await supabase
        .rpc('get_edit_counts_by_type', { job_id_param: jobData.id })
        .select();
      
      if (!editCountsError && editCounts) {
        contentEdits = editCounts;
      } else {
        // Fallback to direct query if RPC not available
        const { data: styleEdits, error: styleError } = await supabase
          .from('content_edits')
          .select('*', { count: 'exact', head: true })
          .eq('job_id', jobData.id)
          .eq('edit_type', 'style')
          .eq('is_deleted', false);
          
        const { data: redundancyEdits, error: redundancyError } = await supabase
          .from('content_edits')
          .select('*', { count: 'exact', head: true })
          .eq('job_id', jobData.id)
          .eq('edit_type', 'redundancy')
          .eq('is_deleted', false);
          
        const { data: feedbackEdits, error: feedbackError } = await supabase
          .from('content_edits')
          .select('*', { count: 'exact', head: true })
          .eq('job_id', jobData.id)
          .eq('edit_type', 'feedback')
          .eq('is_deleted', false);
          
        contentEdits = [
          { edit_type: 'style', count: styleError ? 0 : styleEdits.length },
          { edit_type: 'redundancy', count: redundancyError ? 0 : redundancyEdits.length },
          { edit_type: 'feedback', count: feedbackError ? 0 : feedbackEdits.length }
        ];
      }
      
      // Determine progress percentage based on job status
      switch (jobData.status) {
        case 'processing':
          progressDetails = {
            percentage: 40,
            message: 'Processing style transformation...'
          };
          break;
        case 'processing_redundancy':
          progressDetails = {
            percentage: 75,
            message: 'Removing redundancy...'
          };
          break;
        case 'completed':
          progressDetails = {
            percentage: 100,
            message: 'Processing complete'
          };
          break;
        case 'failed':
          progressDetails = {
            percentage: 0,
            message: `Failed: ${jobData.error || 'Unknown error'}`
          };
          break;
        default:
          progressDetails = {
            percentage: 5,
            message: 'Starting job...'
          };
      }
    } else {
      progressDetails = {
        percentage: 5,
        message: 'Job queued, waiting to start...'
      };
    }
    
    // Return job details with progress information
    return new Response(JSON.stringify({ 
      success: true,
      job: {
        id: jobData.id,
        status: jobData.status,
        created_at: jobData.created_at,
        completed_at: jobData.completed_at,
        error: jobData.error || null,
        document: {
          id: jobData.documents.id,
          title: jobData.documents.title,
          content_plan_outline_guid: jobData.documents.content_plan_outline_guid
        },
        original_content: jobData.original_content,
        edited_content: jobData.edited_content || null,
        analysis: jobData.analysis || null,
        versions: jobData.versions || [],
        thinking_logs: thinkingLogs,
        content_edits: {
          summary: contentEdits,
          total: contentEdits.reduce((sum, item) => sum + Number(item.count), 0),
          view_url: `/get-content-edits?job_id=${jobData.id}`
        },
        progress: progressDetails
      },
      edit_counts: contentEdits,
      total_edits: contentEdits.reduce((sum, item) => sum + Number(item.count), 0)
    }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });
  } catch (error) {
    console.error('Error in get-edit-job-status function:', error);
    
    return new Response(
      JSON.stringify({ 
        error: `Failed to get job status: ${error.message}` 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    );
  }
})