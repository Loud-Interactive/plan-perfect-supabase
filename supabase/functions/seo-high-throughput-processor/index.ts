import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

const FUNCTION_NAME = 'seo-high-throughput-processor';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Initialize Supabase client
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

interface ProcessorRequest {
  workerId: string;
  batchId?: string;
  limit?: number;
  timeout?: number;
  shardId?: number;
  totalShards?: number;
}

interface ProcessorStats {
  workerId: string;
  processed: number;
  success: number;
  failed: number;
  locked: number;
  lockFailed: number;
  startTime: number;
  endTime?: number;
  duration?: number;
}

// Configuration
const CONFIG = {
  BATCH_SIZE: 5,
  LOCK_TIMEOUT_MS: 600000, // 10 minutes
  REQUEST_TIMEOUT_MS: 300000, // 5 minutes per job (increased for DeepSeek AI processing)
  MAX_RETRIES: 2,
  ENABLE_SHARDING: false  // Disable sharding for debugging
};

// Generate unique processor ID
function generateProcessorId(workerId: string): string {
  return `${workerId}-${Date.now()}`;
}

// Calculate shard for worker
function getWorkerShard(workerId: string, totalShards: number): number {
  const hash = workerId.split('').reduce((a, b) => {
    a = ((a << 5) - a) + b.charCodeAt(0);
    return a & a;
  }, 0);
  return Math.abs(hash) % totalShards;
}

// Acquire jobs with optimistic locking - simplified to match working simple test
async function acquireJobs(workerId: string, batchId?: string, limit: number = 1, shardId?: number, totalShards?: number): Promise<any[]> {
  const processorId = generateProcessorId(workerId);
  const lockUntil = new Date(Date.now() + CONFIG.LOCK_TIMEOUT_MS).toISOString();
  
  console.log(`[${workerId}] Acquiring jobs: batchId=${batchId}, limit=${limit}`);
  
  try {
    // Use the exact same approach as the working simple test
    let baseQuery = supabase
      .from('page_seo_queue')
      .select('*')
      .is('locked_by', null)
      .is('completed_at', null);
    
    // Add batch filter if specified
    if (batchId) {
      console.log(`[${workerId}] Filtering by batch: ${batchId}`);
      baseQuery = baseQuery.eq('batch_id', batchId);
    }
    
    // Get available jobs count using exact same pattern as working simple test
    const { count, error: countError } = await supabase
      .from('page_seo_queue')
      .select('*', { count: 'exact', head: true })
      .eq('batch_id', batchId || 'minimal-test')
      .is('locked_by', null)
      .is('completed_at', null);
    
    console.log(`[${workerId}] Available jobs count: ${count}, error: ${countError?.message}`);
    
    if (countError || !count || count === 0) {
      console.log(`[${workerId}] No jobs available: count=${count}, error: ${countError?.message}`);
      return [];
    }
    
    // Use random offset to avoid workers competing for the same jobs
    const randomOffset = Math.floor(Math.random() * Math.min(count, 1000)); // Random offset up to 1000 or total count
    console.log(`[${workerId}] Using random offset: ${randomOffset}`);
    
    const { data: jobs, error: selectError } = await supabase
      .from('page_seo_queue')
      .select('*')
      .eq('batch_id', batchId || 'minimal-test')
      .is('locked_by', null)
      .is('completed_at', null)
      .range(randomOffset, randomOffset + limit - 1);
    
    console.log(`[${workerId}] Selected jobs: ${jobs?.length || 0}, error: ${selectError?.message}`);
    
    if (selectError || !jobs || jobs.length === 0) {
      console.log(`[${workerId}] No jobs selected: jobs=${jobs?.length}, error=${selectError?.message}`);
      return [];
    }
    
    // Try to lock multiple jobs up to the limit
    const lockedJobs = [];
    const jobsToTry = Math.min(jobs.length, limit);
    
    console.log(`[${workerId}] Attempting to lock up to ${jobsToTry} jobs from ${jobs.length} available`);
    
    // Shuffle the jobs array to avoid workers competing for the same jobs
    const shuffledJobs = [...jobs].sort(() => Math.random() - 0.5);
    
    for (let i = 0; i < jobsToTry && lockedJobs.length < limit; i++) {
      const jobToLock = shuffledJobs[i];
      
      try {
        const { data: lockedJob, error: updateError } = await supabase
          .from('page_seo_queue')
          .update({
            locked_by: processorId,
            locked_until: lockUntil,
            locked_at: new Date().toISOString()
          })
          .eq('id', jobToLock.id)
          .is('locked_by', null)
          .is('completed_at', null)
          .select();
        
        if (!updateError && lockedJob && lockedJob.length > 0) {
          lockedJobs.push(...lockedJob);
          console.log(`[${workerId}] Successfully locked job: ${jobToLock.id}`);
        } else if (updateError) {
          console.log(`[${workerId}] Failed to lock job ${jobToLock.id}: ${updateError.message}`);
        } else {
          console.log(`[${workerId}] Job ${jobToLock.id} already locked by another worker`);
        }
      } catch (error) {
        console.log(`[${workerId}] Error trying to lock job ${jobToLock.id}:`, error);
      }
    }
    
    console.log(`[${workerId}] Successfully locked ${lockedJobs.length} jobs out of ${jobsToTry} attempted`);
    
    return lockedJobs;
  } catch (error) {
    console.error(`[${workerId}] Error acquiring jobs:`, error);
    return [];
  }
}

// Normalize URL by adding https:// if missing
function normalizeUrl(url: string): string {
  if (!url) return url;
  
  // Remove any leading/trailing whitespace
  url = url.trim();
  
  // If it already has a protocol, return as-is
  if (url.match(/^https?:\/\//)) {
    return url;
  }
  
  // Add https:// if missing
  return `https://${url}`;
}

// Check if page has HTML content
async function checkPageHtml(pageId: string): Promise<{ hasHtml: boolean; htmlContent?: string }> {
  try {
    const { data: page, error } = await supabase
      .from('pages')
      .select('html')
      .eq('id', pageId)
      .single();
    
    if (error) {
      console.log(`Error checking HTML for page ${pageId}:`, error.message);
      return { hasHtml: false };
    }
    
    const hasHtml = page?.html && page.html.trim().length > 0;
    return { hasHtml, htmlContent: page?.html };
  } catch (error) {
    console.log(`Error checking HTML for page ${pageId}:`, error);
    return { hasHtml: false };
  }
}

// Trigger crawl for a page and requeue it
async function triggerCrawlAndRequeue(job: any): Promise<void> {
  try {
    console.log(`[${job.page_id}] No HTML found, triggering crawl for: ${job.page_url}`);
    
    // Trigger crawl job
    const { error: crawlError } = await supabase
      .from('crawl_jobs')
      .insert({
        page_id: job.page_id,
        url: normalizeUrl(job.page_url),
        status: 'pending',
        priority: 3,
        created_at: new Date().toISOString()
      });
    
    if (crawlError) {
      console.log(`Error creating crawl job for page ${job.page_id}:`, crawlError.message);
    }
    
    // Requeue the SEO job with a delay (increase retry count)
    await supabase
      .from('page_seo_queue')
      .update({
        locked_by: null,
        locked_until: null,
        locked_at: null,
        retry_count: (job.retry_count || 0) + 1,
        error: 'No HTML content, triggered crawl and requeued'
      })
      .eq('id', job.id);
      
    console.log(`[${job.page_id}] Crawl triggered and job requeued`);
  } catch (error) {
    console.error(`Error triggering crawl for page ${job.page_id}:`, error);
  }
}

// Check if job was already completed to prevent duplicate processing
async function isJobCompleted(jobId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('page_seo_queue')
      .select('completed_at')
      .eq('id', jobId)
      .single();
    
    if (error) {
      console.log(`Error checking job completion for ${jobId}:`, error.message);
      return false;
    }
    
    return !!data?.completed_at;
  } catch (error) {
    console.log(`Error checking job completion for ${jobId}:`, error);
    return false;
  }
}

// Process a single job
async function processJob(job: any, stats: ProcessorStats): Promise<{ success: boolean; error?: string; duration: number }> {
  const startTime = Date.now();
  
  try {
    // Check if job was already completed (race condition protection)
    const alreadyCompleted = await isJobCompleted(job.id);
    if (alreadyCompleted) {
      console.log(`[${job.page_id}] Job ${job.id} already completed, skipping`);
      return { success: true, error: 'Already completed', duration: Date.now() - startTime };
    }
    
    // Normalize the URL
    const normalizedUrl = normalizeUrl(job.page_url);
    
    // Check if page has HTML content
    const { hasHtml } = await checkPageHtml(job.page_id);
    
    if (!hasHtml) {
      console.log(`[${job.page_id}] No HTML content found, triggering crawl`);
      await triggerCrawlAndRequeue(job);
      stats.processed++; // Count as processed (though not completed)
      return { success: false, error: 'No HTML - crawl triggered', duration: Date.now() - startTime };
    }
    
    // Call the SEO workflow
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT_MS);
    
    const response = await fetch(`${supabaseUrl}/functions/v1/seo-direct-workflow-track`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseServiceKey}`
      },
      body: JSON.stringify({
        pageId: job.page_id,
        url: normalizedUrl,
        forceRegenerate: false
      }),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    const responseText = await response.text();
    const duration = Date.now() - startTime;
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${responseText.substring(0, 200)}`);
    }
    
    let result;
    try {
      result = JSON.parse(responseText);
    } catch (e) {
      throw new Error('Invalid JSON response');
    }
    
    if (!result.success) {
      throw new Error(result.error || 'Unknown error');
    }
    
    // Mark as completed - check if already completed first to prevent duplicate processing
    const { error: updateError } = await supabase
      .from('page_seo_queue')
      .update({
        completed_at: new Date().toISOString(),
        locked_by: null,
        locked_until: null,
        locked_at: null,
        error: null,
        processing_time_ms: duration
      })
      .eq('id', job.id)
      .is('completed_at', null); // Only update if not already completed
    
    if (updateError) {
      console.log(`Warning: Could not mark job ${job.id} as completed:`, updateError.message);
    }
    
    stats.success++;
    return { success: true, duration };
    
  } catch (error) {
    const duration = Date.now() - startTime;
    
    // For failures, mark as completed with error after too many retries
    const retryCount = (job.retry_count || 0) + 1;
    const shouldComplete = retryCount >= CONFIG.MAX_RETRIES;
    
    const updateData: any = {
      error: error.message,
      locked_by: null,
      locked_until: null,
      locked_at: null,
      processing_time_ms: duration,
      retry_count: retryCount
    };
    
    // Mark as completed if we've exceeded max retries
    if (shouldComplete) {
      updateData.completed_at = new Date().toISOString();
      console.log(`[${job.page_id}] Job ${job.id} failed ${retryCount} times, marking as completed with error`);
    }
    
    await supabase
      .from('page_seo_queue')
      .update(updateData)
      .eq('id', job.id);
    
    stats.failed++;
    return { success: false, error: error.message, duration };
  }
}

// Process jobs concurrently
async function processJobsConcurrently(jobs: any[], stats: ProcessorStats): Promise<void> {
  const promises = jobs.map(async (job) => {
    const result = await processJob(job, stats);
    stats.processed++;
    
    const status = result.success ? '✓' : '✗';
    console.log(`[${stats.workerId}] ${status} Job ${job.id} - ${result.duration}ms`);
    
    return result;
  });
  
  await Promise.allSettled(promises);
}

// Main processing function
async function processJobs(request: ProcessorRequest): Promise<ProcessorStats> {
  const { workerId, batchId, limit = 5, timeout = 600000, shardId, totalShards } = request; // Restored default limit to 5, increased timeout for DeepSeek AI processing
  
  const stats: ProcessorStats = {
    workerId,
    processed: 0,
    success: 0,
    failed: 0,
    locked: 0,
    lockFailed: 0,
    startTime: Date.now()
  };
  
  console.log(`[${workerId}] Starting high-throughput processor`);
  console.log(`Config: batchId=${batchId}, limit=${limit}, timeout=${timeout}, shard=${shardId}/${totalShards}`);
  
  const endTime = Date.now() + timeout;
  let consecutiveEmpty = 0;
  
  while (Date.now() < endTime && consecutiveEmpty < 3) {
    try {
      // Acquire jobs
      const jobs = await acquireJobs(workerId, batchId, limit, shardId, totalShards);
      
      if (jobs.length === 0) {
        consecutiveEmpty++;
        console.log(`[${workerId}] No jobs available (${consecutiveEmpty}/3)`);
        
        // Exponential backoff
        const waitTime = Math.min(1000 * Math.pow(2, consecutiveEmpty), 10000);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }
      
      consecutiveEmpty = 0;
      stats.locked += jobs.length;
      
      console.log(`[${workerId}] Processing ${jobs.length} jobs`);
      
      // Process jobs concurrently
      await processJobsConcurrently(jobs, stats);
      
      // Brief pause between batches
      await new Promise(resolve => setTimeout(resolve, 100));
      
    } catch (error) {
      console.error(`[${workerId}] Error in processing loop:`, error);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  stats.endTime = Date.now();
  stats.duration = stats.endTime - stats.startTime;
  
  const successRate = stats.processed > 0 ? ((stats.success / stats.processed) * 100).toFixed(1) : 0;
  console.log(`[${workerId}] Complete - Processed: ${stats.processed}, Success: ${stats.success} (${successRate}%), Failed: ${stats.failed}, Duration: ${stats.duration}ms`);
  
  return stats;
}

// Release expired locks for this worker's shard
async function releaseExpiredLocks(batchId?: string, shardId?: number, totalShards?: number) {
  try {
    let query = supabase
      .from('page_seo_queue')
      .update({
        locked_by: null,
        locked_until: null,
        locked_at: null
      })
      .lt('locked_until', new Date().toISOString())
      .not('locked_by', 'is', null);
      
    if (batchId) {
      query = query.eq('batch_id', batchId);
    }
    
    if (CONFIG.ENABLE_SHARDING && shardId !== undefined && totalShards) {
      query = query.filter('hashtext(page_id::text)', 'mod', `${totalShards}.${shardId}`);
    }
    
    const { data, error } = await query.select();
    
    if (error) {
      console.error('Error releasing expired locks:', error);
    } else if (data && data.length > 0) {
      console.log(`Released ${data.length} expired locks`);
    }
  } catch (error) {
    console.error('Error in releaseExpiredLocks:', error);
  }
}

// Main handler
serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const request: ProcessorRequest = await req.json();
    
    console.log(`=== SEO High-Throughput Processor - ${request.workerId} ===`);
    
    // Calculate shard if not provided
    const totalShards = request.totalShards || 10;
    const shardId = request.shardId !== undefined ? request.shardId : getWorkerShard(request.workerId, totalShards);
    
    // Release expired locks for this shard
    await releaseExpiredLocks(request.batchId, shardId, totalShards);
    
    // Process jobs
    const stats = await processJobs({
      ...request,
      shardId,
      totalShards
    });
    
    return new Response(
      JSON.stringify({
        success: true,
        stats
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error) {
    console.error('Error in seo-high-throughput-processor:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});