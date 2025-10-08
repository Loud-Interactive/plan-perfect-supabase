// supabase/functions/get-outline-status/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const jobId = url.searchParams.get('job_id');
    
    if (!jobId) {
      return new Response(
        JSON.stringify({ error: 'job_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get job status
    const { data: job, error: jobError } = await supabase
      .from('outline_generation_jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (jobError) {
      throw new Error(`Job not found: ${jobError.message}`);
    }

    // Get outline if job is completed
    let outline = null;
    if (job.status === 'completed') {
      const { data: outlineData, error: outlineError } = await supabase
        .from('content_plan_outlines_ai')
        .select('outline')
        .eq('job_id', jobId)
        .maybeSingle();

      if (!outlineError && outlineData) {
        outline = outlineData.outline;
      }
    }

    // Check if job is stuck (no heartbeat update for more than 30 minutes)
    const thirtyMinutesAgo = new Date();
    thirtyMinutesAgo.setMinutes(thirtyMinutesAgo.getMinutes() - 30);
    const isStuck = job.heartbeat && new Date(job.heartbeat) < thirtyMinutesAgo && 
                   !['completed', 'failed'].includes(job.status);

    // Get progress details
    let progressDetails = {};
    
    const { data: searchTerms } = await supabase
      .from('outline_search_terms')
      .select('search_term')
      .eq('job_id', jobId);
    
    const { data: searchResults, error: searchResultsError } = await supabase
      .from('outline_search_results')
      .select('search_term, url, title')
      .eq('job_id', jobId)
      .limit(20);  // Limit to 20 for performance
    
    const { data: urlAnalyses, error: urlAnalysesError } = await supabase
      .from('outline_url_analyses')
      .select('url, title')
      .eq('job_id', jobId)
      .limit(10);  // Limit to 10 for performance
    
    progressDetails = {
      searchTerms: searchTerms || [],
      searchResults: searchResults || [],
      urlAnalyses: urlAnalyses || [],
      counts: {
        searchTerms: searchTerms?.length || 0,
        searchResults: searchResults?.length || 0,
        urlAnalyses: urlAnalyses?.length || 0
      }
    };

    return new Response(
      JSON.stringify({ 
        job_id: jobId,
        status: job.status,
        progress: getProgressPercentage(job.status),
        progressDetails,
        outline,
        error: job.error || null,
        isStuck: isStuck,
        job_details: {
          post_title: job.post_title,
          content_plan_keyword: job.content_plan_keyword,
          post_keyword: job.post_keyword,
          domain: job.domain
        },
        created_at: job.created_at,
        updated_at: job.updated_at,
        heartbeat: job.heartbeat
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in get-outline-status function:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function getProgressPercentage(status: string): number {
  const statusMap: Record<string, number> = {
    'pending': 0,
    'started': 10,
    'determining_search_terms': 20,
    'running_searches': 40,
    'search_queued': 45,
    'analyzing_results': 60,
    'generating_outline': 80,
    'completed': 100,
    // Error states - return negative to indicate error
    'failed': -1,
    'error_starting_search': -1,
    'search_failed': -1,
    'error_starting_queue_processing': -1
  };
  
  return statusMap[status] || 0;
}