import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { logError, retryWithBackoff } from '../utils/error-handling.ts';

const FUNCTION_NAME = 'process-classification-batch';
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000;

// Interface for classification results
interface KeywordClassification {
  Keyword: string;
  Primary: string;
  Secondary: string;
  Tertiary: string;
  Relevant: string;
  Reasoning: string;
  BusinessRelationshipModel: string;
}

serve(async (req) => {
  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  // Validate request method
  if (req.method !== 'POST') {
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
    const deepseekApiKey = Deno.env.get('DEEPSEEK_API_KEY');

    // Validate API key
    if (!deepseekApiKey) {
      console.error('[DEBUG] DeepSeek API key is not configured');
      return new Response(
        JSON.stringify({ error: 'DeepSeek API key is not configured' }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Create Supabase client with admin privileges
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Parse request body
    const { jobId, manual = false } = await req.json();
    
    if (!jobId) {
      return new Response(
        JSON.stringify({ error: 'Job ID is required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }
    
    // Get job information
    const { data: job, error: jobError } = await supabase
      .from('classification_jobs')
      .select('*')
      .eq('id', jobId)
      .single();
      
    if (jobError || !job) {
      return new Response(
        JSON.stringify({ error: `Job not found: ${jobError?.message || 'Unknown error'}` }),
        {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }
    
    // Check if job is already completed or failed
    if (job.status === 'completed') {
      return new Response(
        JSON.stringify({ message: 'Job is already completed', jobId, status: job.status }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }
    
    if (job.status === 'failed' && !manual) {
      return new Response(
        JSON.stringify({ error: 'Job has failed and needs manual intervention', jobId, status: job.status }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }
    
    // Get the next batch to process
    const { data: batchData, error: batchError } = await supabase
      .rpc('get_next_classification_batch', { job_uuid: jobId });
    
    if (batchError) {
      console.error('Error getting next batch:', batchError);
      await logError(FUNCTION_NAME, jobId, new Error(`Error getting next batch: ${batchError.message}`));
      
      return new Response(
        JSON.stringify({ error: `Error getting next batch: ${batchError.message}`, jobId }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }
    
    // Check if there's a batch to process
    if (!batchData || batchData.length === 0) {
      console.log('No more batches to process for job:', jobId);
      
      // Update job progress to make sure it's completed
      await supabase.rpc('update_classification_job_progress', { job_uuid: jobId });
      
      // Get final job status
      const { data: updatedJob } = await supabase
        .from('classification_jobs')
        .select('status, progress')
        .eq('id', jobId)
        .single();
      
      return new Response(
        JSON.stringify({ 
          message: 'No more batches to process',
          jobId,
          status: updatedJob?.status || 'completed',
          progress: updatedJob?.progress || 100
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }
    
    const batch = batchData[0];
    console.log(`Processing batch ${batch.batch_number} for job ${jobId} with ${batch.keywords.length} keywords`);
    
    // Process the batch
    try {
      // Call classify-keyword endpoint
      const classifyEndpoint = `${supabaseUrl}/functions/v1/classify-keyword`;
      
      const response = await fetch(classifyEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({
          domain: batch.domain,
          keywords: batch.keywords,
          ppData: batch.preferences_data,
          suggestedCategories: batch.suggested_categories,
          jobId: jobId
        }),
      });
      
      if (!response.ok) {
        throw new Error(`Classification failed with status: ${response.status}`);
      }
      
      const result = await response.json();
      
      // Store results and update job progress
      await supabase.rpc('update_classification_job_progress', { job_uuid: jobId });
      
      // Return batch processing result
      return new Response(
        JSON.stringify({
          message: 'Batch processed successfully',
          jobId,
          batchNumber: batch.batch_number,
          processedCount: result.results ? result.results.length : 0,
          missingCount: result.missingCount || 0,
          complete: result.complete
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    } catch (error) {
      console.error('Error processing batch:', error);
      await logError(FUNCTION_NAME, jobId, error instanceof Error ? error : new Error(String(error)));
      
      // Mark the job as failed
      await supabase.rpc('mark_classification_job_failed', { 
        job_uuid: jobId,
        error_message: error instanceof Error ? error.message : String(error)
      });
      
      return new Response(
        JSON.stringify({ error: 'Error processing batch', message: String(error), jobId }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }
  } catch (error) {
    console.error('Error processing classification batch:', error);
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