// SEO Pipeline Manager
// Orchestrates the complete SEO processing pipeline with stage-based processing

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PipelineRequest {
  // Single page processing
  pageId?: string;
  url?: string;
  
  // Batch processing
  batchName?: string;
  pageIds?: string[];
  whereClause?: string;
  
  // Pipeline configuration
  priority?: number;
  maxRetries?: number;
  
  // Operation type
  operation: 'create' | 'status' | 'retry' | 'cancel' | 'cleanup';
  
  // For status/retry/cancel operations
  batchId?: string;
  jobId?: string;
}

interface PipelineResponse {
  success: boolean;
  batchId?: string;
  jobId?: string;
  operation?: string;
  stats?: any;
  message?: string;
  error?: string;
}

serve(async (req) => {
  // Handle CORS preflight request
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Create Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Parse request body
    const {
      pageId,
      url,
      batchName = 'seo-pipeline',
      pageIds,
      whereClause,
      priority = 1,
      maxRetries = 3,
      operation,
      batchId,
      jobId
    } = await req.json() as PipelineRequest;

    console.log(`SEO Pipeline Manager: ${operation} operation`);

    let response: PipelineResponse;

    switch (operation) {
      case 'create':
        response = await createPipelineJobs(supabaseClient, {
          pageId,
          url,
          batchName,
          pageIds,
          whereClause,
          priority,
          maxRetries
        });
        break;

      case 'status':
        response = await getPipelineStatus(supabaseClient, batchId, jobId);
        break;

      case 'retry':
        response = await retryPipelineJobs(supabaseClient, batchId, jobId);
        break;

      case 'cancel':
        response = await cancelPipelineJobs(supabaseClient, batchId, jobId);
        break;

      case 'cleanup':
        response = await cleanupPipeline(supabaseClient);
        break;

      default:
        throw new Error(`Unknown operation: ${operation}`);
    }

    return new Response(
      JSON.stringify(response),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error) {
    console.error('Error in seo-pipeline-manager:', error);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  }
});

// Create new pipeline jobs
async function createPipelineJobs(supabaseClient: any, params: any): Promise<PipelineResponse> {
  const { pageId, url, batchName, pageIds, whereClause, priority, maxRetries } = params;

  console.log(`Creating pipeline jobs for batch: ${batchName}`);

  // Handle single page
  if (pageId || url) {
    let targetPageId = pageId;
    
    // If URL provided, find or create page
    if (url && !pageId) {
      const { data: existingPage } = await supabaseClient
        .from('pages')
        .select('id')
        .eq('url', url)
        .single();
        
      if (existingPage) {
        targetPageId = existingPage.id;
      } else {
        // Create new page
        const { data: newPage, error: createError } = await supabaseClient
          .from('pages')
          .insert({ url })
          .select('id')
          .single();
          
        if (createError) {
          throw new Error(`Failed to create page: ${createError.message}`);
        }
        targetPageId = newPage.id;
      }
    }

    // Queue single page
    const result = await supabaseClient.rpc('queue_pages_for_seo_pipeline', {
      batch_name: batchName,
      page_ids: [targetPageId],
      priority_level: priority,
      max_retry_count: maxRetries
    });

    if (!result.data) {
      throw new Error('Failed to queue page for pipeline');
    }

    const batchInfo = JSON.parse(result.data);
    
    // Trigger initial stage processing
    await triggerStageProcessors(supabaseClient, batchInfo.batch_id);

    return {
      success: true,
      operation: 'create',
      batchId: batchInfo.batch_id,
      message: `Queued ${batchInfo.pages_added} page(s) for pipeline processing`
    };
  }

  // Handle batch processing
  let result;
  
  if (pageIds && pageIds.length > 0) {
    // Queue specific page IDs
    result = await supabaseClient.rpc('queue_pages_for_seo_pipeline', {
      batch_name: batchName,
      page_ids: pageIds,
      priority_level: priority,
      max_retry_count: maxRetries
    });
  } else {
    // Queue all pages needing SEO (default behavior)
    result = await supabaseClient.rpc('queue_pages_for_seo_pipeline', {
      batch_name: batchName,
      priority_level: priority,
      max_retry_count: maxRetries
    });
  }

  if (!result.data) {
    throw new Error('Failed to queue pages for pipeline');
  }

  const batchInfo = JSON.parse(result.data);
  
  if (batchInfo.pages_added === 0) {
    return {
      success: true,
      operation: 'create',
      batchId: batchInfo.batch_id,
      message: 'No pages needed to be queued (all already processed or in progress)'
    };
  }

  // Trigger initial stage processing
  await triggerStageProcessors(supabaseClient, batchInfo.batch_id);

  return {
    success: true,
    operation: 'create',
    batchId: batchInfo.batch_id,
    message: `Queued ${batchInfo.pages_added} page(s) for pipeline processing`
  };
}

// Get pipeline status
async function getPipelineStatus(supabaseClient: any, batchId?: string, jobId?: string): Promise<PipelineResponse> {
  if (jobId) {
    // Get specific job status
    const { data: job, error } = await supabaseClient
      .from('seo_pipeline_jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (error) {
      throw new Error(`Failed to get job status: ${error.message}`);
    }

    return {
      success: true,
      operation: 'status',
      jobId,
      stats: job
    };
  }

  // Get batch statistics
  const { data: batchStats, error: statsError } = await supabaseClient
    .rpc('get_pipeline_batch_stats', { batch_filter: batchId });

  if (statsError) {
    throw new Error(`Failed to get batch stats: ${statsError.message}`);
  }

  // Get stage breakdown
  let stageQuery = supabaseClient
    .from('seo_pipeline_jobs')
    .select('current_stage, count(*)')
    .group('current_stage');
    
  if (batchId) {
    stageQuery = stageQuery.eq('batch_id', batchId);
  }
  
  const { data: stageBreakdown, error: stageError } = await stageQuery;

  return {
    success: true,
    operation: 'status',
    batchId,
    stats: {
      batchStats: batchStats || [],
      stageBreakdown: stageBreakdown || []
    }
  };
}

// Retry failed pipeline jobs
async function retryPipelineJobs(supabaseClient: any, batchId?: string, jobId?: string): Promise<PipelineResponse> {
  if (jobId) {
    // Retry specific job
    const { error } = await supabaseClient
      .from('seo_pipeline_jobs')
      .update({
        current_stage: 'queued',
        locked_by: null,
        locked_at: null,
        locked_until: null,
        last_error: null,
        error_stage: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', jobId)
      .eq('current_stage', 'failed');

    if (error) {
      throw new Error(`Failed to retry job: ${error.message}`);
    }

    return {
      success: true,
      operation: 'retry',
      jobId,
      message: 'Job queued for retry'
    };
  }

  // Retry all failed jobs in batch
  const { error } = await supabaseClient
    .from('seo_pipeline_jobs')
    .update({
      current_stage: 'queued',
      locked_by: null,
      locked_at: null,
      locked_until: null,
      last_error: null,
      error_stage: null,
      updated_at: new Date().toISOString()
    })
    .eq('batch_id', batchId)
    .eq('current_stage', 'failed');

  if (error) {
    throw new Error(`Failed to retry batch jobs: ${error.message}`);
  }

  return {
    success: true,
    operation: 'retry',
    batchId,
    message: 'Failed jobs queued for retry'
  };
}

// Cancel pipeline jobs
async function cancelPipelineJobs(supabaseClient: any, batchId?: string, jobId?: string): Promise<PipelineResponse> {
  const updateData = {
    current_stage: 'cancelled',
    locked_by: null,
    locked_at: null,
    locked_until: null,
    pipeline_completed_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  if (jobId) {
    // Cancel specific job
    const { error } = await supabaseClient
      .from('seo_pipeline_jobs')
      .update(updateData)
      .eq('id', jobId)
      .not('current_stage', 'in', '(completed,failed,cancelled)');

    if (error) {
      throw new Error(`Failed to cancel job: ${error.message}`);
    }

    return {
      success: true,
      operation: 'cancel',
      jobId,
      message: 'Job cancelled'
    };
  }

  // Cancel all jobs in batch
  const { error } = await supabaseClient
    .from('seo_pipeline_jobs')
    .update(updateData)
    .eq('batch_id', batchId)
    .not('current_stage', 'in', '(completed,failed,cancelled)');

  if (error) {
    throw new Error(`Failed to cancel batch jobs: ${error.message}`);
  }

  return {
    success: true,
    operation: 'cancel',
    batchId,
    message: 'Batch jobs cancelled'
  };
}

// Cleanup expired locks and old jobs
async function cleanupPipeline(supabaseClient: any): Promise<PipelineResponse> {
  // Clean up expired locks
  const { data: lockCleanup } = await supabaseClient.rpc('cleanup_expired_pipeline_locks');
  
  // Clean up old completed jobs (older than 7 days)
  const { error: cleanupError } = await supabaseClient
    .from('seo_pipeline_jobs')
    .delete()
    .eq('current_stage', 'completed')
    .lt('pipeline_completed_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

  if (cleanupError) {
    console.error('Warning: Failed to cleanup old jobs:', cleanupError.message);
  }

  return {
    success: true,
    operation: 'cleanup',
    message: `Cleaned up ${lockCleanup || 0} expired locks and old completed jobs`
  };
}

// Trigger stage processors to start working
async function triggerStageProcessors(supabaseClient: any, batchId: string) {
  console.log(`Triggering stage processors for batch: ${batchId}`);
  
  // We'll implement this to call the individual stage workers
  // For now, just log that we would trigger them
  console.log('Stage processors will be triggered (individual worker functions will handle this)');
}