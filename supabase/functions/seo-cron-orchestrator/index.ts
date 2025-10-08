import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

const FUNCTION_NAME = 'seo-cron-orchestrator';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Initialize Supabase client
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

interface CronConfig {
  workersPerMinute: number;
  pagesPerWorker: number;
  maxConcurrentWorkers: number;
  workerTimeoutSeconds: number;
}

interface CronRequest {
  operation: 'start' | 'status' | 'stop';
  batchId?: string;
  config?: CronConfig;
}

// Default configuration for 2000 pages/hour
const DEFAULT_CONFIG: CronConfig = {
  workersPerMinute: 20, // Launch 20 workers per minute
  pagesPerWorker: 5,    // Each worker processes 5 pages
  maxConcurrentWorkers: 100, // Max 100 workers running at once
  workerTimeoutSeconds: 300  // 5 minute timeout per worker
};

// Track active workers globally
const activeWorkers = new Set<string>();
let cronInterval: number | null = null;
let isRunning = false;

// Get pending page count for a batch
async function getPendingPageCount(batchId?: string): Promise<number> {
  let query = supabase
    .from('page_seo_queue')
    .select('*', { count: 'exact', head: true })
    .is('completed_at', null);
    
  if (batchId) {
    query = query.eq('batch_id', batchId);
  }
  
  const { count, error } = await query;
  
  if (error) {
    console.error('Error getting pending count:', error);
    return 0;
  }
  
  return count || 0;
}

// Launch a worker to process pages
async function launchWorker(workerId: string, batchId?: string, pagesPerWorker: number = 5): Promise<boolean> {
  try {
    console.log(`Launching worker ${workerId} for ${pagesPerWorker} pages`);
    
    // Add to active workers
    activeWorkers.add(workerId);
    
    // Call the high-throughput processor
    const response = await fetch(`${supabaseUrl}/functions/v1/seo-high-throughput-processor`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseServiceKey}`
      },
      body: JSON.stringify({
        workerId,
        batchId,
        limit: pagesPerWorker,
        timeout: 300000 // 5 minutes
      })
    });
    
    // Don't wait for response - fire and forget
    // The worker will remove itself from activeWorkers when done
    response.body?.cancel();
    
    return true;
  } catch (error) {
    console.error(`Failed to launch worker ${workerId}:`, error);
    activeWorkers.delete(workerId);
    return false;
  }
}

// Cleanup completed workers
async function cleanupCompletedWorkers() {
  // Remove workers that have been running too long (assumed dead)
  const cutoffTime = Date.now() - (10 * 60 * 1000); // 10 minutes ago
  
  for (const workerId of activeWorkers) {
    const workerStartTime = parseInt(workerId.split('-')[1]);
    if (workerStartTime < cutoffTime) {
      console.log(`Removing stale worker: ${workerId}`);
      activeWorkers.delete(workerId);
    }
  }
  
  console.log(`Active workers: ${activeWorkers.size}`);
}

// Main cron execution logic
async function executeCronCycle(config: CronConfig, batchId?: string) {
  try {
    // Check pending work
    const pendingPages = await getPendingPageCount(batchId);
    
    if (pendingPages === 0) {
      console.log('No pending pages, stopping cron...');
      stopCron();
      return;
    }
    
    // Cleanup stale workers
    await cleanupCompletedWorkers();
    
    // Calculate how many workers to launch
    const currentWorkers = activeWorkers.size;
    const maxNewWorkers = Math.min(
      config.workersPerMinute,
      config.maxConcurrentWorkers - currentWorkers,
      Math.ceil(pendingPages / config.pagesPerWorker)
    );
    
    if (maxNewWorkers <= 0) {
      console.log(`Cannot launch workers: current=${currentWorkers}, max=${config.maxConcurrentWorkers}, pending=${pendingPages}`);
      return;
    }
    
    console.log(`Launching ${maxNewWorkers} workers (pending: ${pendingPages}, active: ${currentWorkers})`);
    
    // Launch workers
    const launchPromises = [];
    for (let i = 0; i < maxNewWorkers; i++) {
      const workerId = `worker-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      launchPromises.push(launchWorker(workerId, batchId, config.pagesPerWorker));
    }
    
    // Launch all workers concurrently
    const results = await Promise.allSettled(launchPromises);
    const successful = results.filter(r => r.status === 'fulfilled' && r.value).length;
    
    console.log(`Successfully launched ${successful}/${maxNewWorkers} workers`);
    
  } catch (error) {
    console.error('Error in cron cycle:', error);
  }
}

// Start the cron scheduler
function startCron(config: CronConfig, batchId?: string) {
  if (isRunning) {
    console.log('Cron already running');
    return false;
  }
  
  isRunning = true;
  console.log('Starting cron scheduler with config:', config);
  
  // Execute immediately
  executeCronCycle(config, batchId);
  
  // Schedule every minute
  cronInterval = setInterval(() => {
    if (isRunning) {
      executeCronCycle(config, batchId);
    }
  }, 60000); // Every minute
  
  return true;
}

// Stop the cron scheduler
function stopCron() {
  if (!isRunning) {
    return false;
  }
  
  isRunning = false;
  
  if (cronInterval) {
    clearInterval(cronInterval);
    cronInterval = null;
  }
  
  console.log('Cron scheduler stopped');
  return true;
}

// Get current status
function getStatus() {
  return {
    isRunning,
    activeWorkers: activeWorkers.size,
    workerIds: Array.from(activeWorkers)
  };
}

// Main handler
serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const request: CronRequest = await req.json();
    const { operation, batchId, config } = request;
    
    console.log(`=== SEO Cron Orchestrator - ${operation} ===`);
    
    let result: any;
    
    switch (operation) {
      case 'start':
        const cronConfig = { ...DEFAULT_CONFIG, ...config };
        const started = startCron(cronConfig, batchId);
        result = {
          success: started,
          message: started ? 'Cron started' : 'Cron already running',
          config: cronConfig,
          status: getStatus()
        };
        break;
        
      case 'status':
        const pendingPages = await getPendingPageCount(batchId);
        result = {
          success: true,
          status: getStatus(),
          pendingPages,
          batchId
        };
        break;
        
      case 'stop':
        const stopped = stopCron();
        result = {
          success: stopped,
          message: stopped ? 'Cron stopped' : 'Cron was not running',
          status: getStatus()
        };
        break;
        
      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
    
    return new Response(
      JSON.stringify(result),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error) {
    console.error('Error in seo-cron-orchestrator:', error);
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