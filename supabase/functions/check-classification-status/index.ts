import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { logError } from '../utils/error-handling.ts';

const FUNCTION_NAME = 'check-classification-status';

serve(async (req) => {
  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  // Only GET method is supported
  if (req.method !== 'GET') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }

  try {
    // Get environment variables
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    
    // Create Supabase client
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Parse URL for query parameters
    const url = new URL(req.url);
    const jobId = url.searchParams.get('jobId');
    const userId = url.searchParams.get('userId'); // For admin usage only
    
    // Get user authentication from request
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Extract JWT token
    const token = authHeader.replace('Bearer ', '');
    
    // Verify the token and get user information
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized: Invalid token' }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }
    
    // For userId parameter - only allow admins/service roles to check other users' jobs
    let checkUserId = user.id;
    if (userId && userId !== user.id) {
      // Check if the user has admin rights (could check against a specific role)
      const { data: isAdmin } = await supabase
        .rpc('check_admin_role', { user_uuid: user.id })
        .single();
        
      if (!isAdmin || !isAdmin.is_admin) {
        return new Response(
          JSON.stringify({ error: 'Unauthorized: Cannot check other users\' jobs' }),
          {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }
      
      checkUserId = userId;
    }
    
    let query = supabase
      .from('classification_jobs')
      .select(`
        id, 
        domain, 
        status, 
        progress, 
        batch_size,
        current_batch,
        total_batches,
        created_at,
        updated_at,
        last_processed_at,
        error,
        metadata
      `);
      
    // If jobId is provided, get specific job
    if (jobId) {
      query = query
        .eq('id', jobId)
        .eq('user_id', checkUserId)
        .limit(1);
    } else {
      // Otherwise get all jobs for the user
      query = query
        .eq('user_id', checkUserId)
        .order('created_at', { ascending: false });
    }
    
    const { data: jobs, error: jobsError } = await query;
      
    if (jobsError) {
      console.error('Error fetching job status:', jobsError);
      await logError(FUNCTION_NAME, jobId, new Error(`Error fetching job status: ${jobsError.message}`));
      
      return new Response(
        JSON.stringify({ error: `Error fetching job status: ${jobsError.message}` }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }
    
    // If specific job requested but not found
    if (jobId && (!jobs || jobs.length === 0)) {
      return new Response(
        JSON.stringify({ error: 'Job not found or access denied' }),
        {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }
    
    // For each job, get count of results
    const jobsWithCounts = await Promise.all(jobs.map(async (job) => {
      const { count } = await supabase
        .from('classification_results')
        .select('*', { count: 'exact', head: true })
        .eq('job_id', job.id);
        
      return {
        ...job,
        resultsCount: count || 0,
        estimatedTimeRemaining: calculateEstimatedTimeRemaining(job, count || 0)
      };
    }));
    
    // Return response
    return new Response(
      JSON.stringify({
        data: jobId ? jobsWithCounts[0] : jobsWithCounts,
        timestamp: new Date().toISOString()
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error checking classification status:', error);
    await logError(FUNCTION_NAME, null, error instanceof Error ? error : new Error(String(error)));
    
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

/**
 * Calculates estimated time remaining for a job based on progress and processing rate
 */
function calculateEstimatedTimeRemaining(job: any, resultsCount: number): string {
  // If job is completed or failed, no time remaining
  if (job.status === 'completed' || job.status === 'failed') {
    return 'N/A';
  }
  
  // If job hasn't started processing yet
  if (job.current_batch === 0 || !job.last_processed_at) {
    return 'Waiting to start';
  }
  
  // Calculate time elapsed since job creation
  const createdAt = new Date(job.created_at).getTime();
  const now = new Date().getTime();
  const elapsedMs = now - createdAt;
  
  // Calculate processing rate (keywords per millisecond)
  const rate = resultsCount / elapsedMs;
  
  // If rate is too low or can't be calculated
  if (!rate || rate <= 0) {
    return 'Calculating...';
  }
  
  // Get total keywords from batch size and total batches
  const totalKeywords = job.batch_size * job.total_batches;
  const remainingKeywords = totalKeywords - resultsCount;
  
  // Calculate remaining time in milliseconds
  const remainingMs = remainingKeywords / rate;
  
  // Convert to human-readable format
  if (remainingMs < 60000) {
    return 'Less than a minute';
  } else if (remainingMs < 3600000) {
    const minutes = Math.round(remainingMs / 60000);
    return `About ${minutes} minute${minutes !== 1 ? 's' : ''}`;
  } else if (remainingMs < 86400000) {
    const hours = Math.round(remainingMs / 3600000);
    return `About ${hours} hour${hours !== 1 ? 's' : ''}`;
  } else {
    const days = Math.round(remainingMs / 86400000);
    return `About ${days} day${days !== 1 ? 's' : ''}`;
  }
}