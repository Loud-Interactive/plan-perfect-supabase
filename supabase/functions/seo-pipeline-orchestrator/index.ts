// SEO Pipeline Orchestrator
// Coordinates all pipeline workers and monitors overall progress

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface OrchestratorRequest {
  orchestratorId?: string;
  maxWorkers?: number;
  workersPerStage?: number;
  batchId?: string;
  durationMinutes?: number;
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
      orchestratorId = `orchestrator-${Date.now()}`,
      maxWorkers = 20,
      workersPerStage = 5,
      batchId,
      durationMinutes = 60
    } = await req.json() as OrchestratorRequest;

    console.log(`SEO Pipeline Orchestrator: ${orchestratorId} starting for ${durationMinutes} minutes`);

    const results = {
      orchestratorId,
      startTime: Date.now(),
      endTime: 0,
      duration: 0,
      workersLaunched: 0,
      cycles: 0,
      stageStats: {} as Record<string, any>,
      errors: [] as string[]
    };

    const startTime = Date.now();
    const endTime = startTime + (durationMinutes * 60 * 1000);

    // Main orchestration loop
    while (Date.now() < endTime) {
      try {
        results.cycles++;
        console.log(`\n=== Orchestration Cycle ${results.cycles} ===`);

        // Step 1: Clean up expired locks
        await supabaseClient.rpc('cleanup_expired_pipeline_locks');

        // Step 2: Get pipeline statistics
        const stats = await getPipelineStats(supabaseClient, batchId);
        results.stageStats = stats;

        console.log('Pipeline Status:');
        Object.entries(stats.stageBreakdown).forEach(([stage, count]) => {
          console.log(`  ${stage}: ${count} jobs`);
        });

        // Step 3: Launch workers based on workload
        const workersToLaunch = calculateWorkersNeeded(stats, workersPerStage, maxWorkers);
        
        if (workersToLaunch.total > 0) {
          console.log(`Launching ${workersToLaunch.total} workers:`, workersToLaunch);
          
          const workerPromises = [];

          // Launch crawler workers
          for (let i = 0; i < workersToLaunch.crawler; i++) {
            workerPromises.push(launchWorker('crawler', `${orchestratorId}-crawler-${i}`));
          }

          // Launch researcher workers
          for (let i = 0; i < workersToLaunch.researcher; i++) {
            workerPromises.push(launchWorker('researcher', `${orchestratorId}-researcher-${i}`));
          }

          // Launch generator workers
          for (let i = 0; i < workersToLaunch.generator; i++) {
            workerPromises.push(launchWorker('generator', `${orchestratorId}-generator-${i}`));
          }

          // Wait for all workers to start (but don't wait for completion)
          await Promise.allSettled(workerPromises);
          results.workersLaunched += workersToLaunch.total;
        } else {
          console.log('No workers needed at this time');
        }

        // Step 4: Check if we're done
        if (stats.stageBreakdown.queued === 0 && 
            stats.stageBreakdown.processing === 0 && 
            stats.stageBreakdown.keyword_complete === 0 &&
            stats.stageBreakdown.crawl_complete === 0) {
          console.log('All jobs completed or no work available, ending orchestration');
          break;
        }

        // Step 5: Wait before next cycle (30 seconds)
        await new Promise(resolve => setTimeout(resolve, 30000));

      } catch (cycleError) {
        console.error(`Error in orchestration cycle ${results.cycles}:`, cycleError);
        results.errors.push(`Cycle ${results.cycles}: ${cycleError instanceof Error ? cycleError.message : String(cycleError)}`);
        
        // Wait a bit before retrying
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
    }

    results.endTime = Date.now();
    results.duration = results.endTime - results.startTime;

    console.log(`\nOrchestrator ${orchestratorId} completed:`);
    console.log(`- Duration: ${results.duration / 1000}s`);
    console.log(`- Cycles: ${results.cycles}`);
    console.log(`- Workers launched: ${results.workersLaunched}`);

    return new Response(
      JSON.stringify({
        success: true,
        ...results
      }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );

  } catch (error) {
    console.error('Error in seo-pipeline-orchestrator:', error);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  }
});

// Get pipeline statistics
async function getPipelineStats(supabaseClient: any, batchId?: string) {
  // Get stage breakdown
  const { data: stageData } = await supabaseClient
    .from('seo_pipeline_jobs')
    .select('current_stage')
    .modify((query: any) => {
      if (batchId) {
        query.eq('batch_id', batchId);
      }
    });

  const stageBreakdown = {
    queued: 0,
    crawl_complete: 0,
    keyword_complete: 0,
    processing: 0,
    completed: 0,
    failed: 0
  };

  if (stageData) {
    stageData.forEach((job: any) => {
      const stage = job.current_stage;
      if (stage === 'queued') {
        stageBreakdown.queued++;
      } else if (stage === 'crawl_complete') {
        stageBreakdown.crawl_complete++;
      } else if (stage === 'keyword_complete') {
        stageBreakdown.keyword_complete++;
      } else if (stage === 'completed') {
        stageBreakdown.completed++;
      } else if (stage === 'failed') {
        stageBreakdown.failed++;
      } else {
        stageBreakdown.processing++;
      }
    });
  }

  // Get active workers
  const { data: workers } = await supabaseClient
    .from('seo_pipeline_jobs')
    .select('locked_by, current_stage')
    .not('locked_by', 'is', null);

  const activeWorkers = workers ? workers.length : 0;

  return {
    stageBreakdown,
    activeWorkers,
    totalJobs: stageData ? stageData.length : 0
  };
}

// Calculate how many workers we need for each stage
function calculateWorkersNeeded(stats: any, workersPerStage: number, maxWorkers: number) {
  const breakdown = stats.stageBreakdown;
  const activeWorkers = stats.activeWorkers || 0;

  // Calculate ideal workers for each stage
  const idealCrawler = Math.min(Math.ceil(breakdown.queued / 10), workersPerStage);
  const idealResearcher = Math.min(Math.ceil(breakdown.crawl_complete / 10), workersPerStage);
  const idealGenerator = Math.min(Math.ceil(breakdown.keyword_complete / 5), workersPerStage);

  // Don't exceed max workers or launch if we already have enough active workers
  const totalIdeal = idealCrawler + idealResearcher + idealGenerator;
  const availableSlots = Math.max(0, maxWorkers - activeWorkers);
  
  if (totalIdeal === 0 || availableSlots === 0) {
    return { crawler: 0, researcher: 0, generator: 0, total: 0 };
  }

  // Scale down proportionally if we don't have enough slots
  const scale = Math.min(1, availableSlots / totalIdeal);
  
  return {
    crawler: Math.floor(idealCrawler * scale),
    researcher: Math.floor(idealResearcher * scale),
    generator: Math.floor(idealGenerator * scale),
    total: Math.floor(totalIdeal * scale)
  };
}

// Launch a worker of specified type
async function launchWorker(workerType: string, workerId: string) {
  const functionName = `seo-pipeline-${workerType}`;
  const maxJobs = workerType === 'generator' ? 3 : 10; // Generators are slower
  
  try {
    console.log(`Launching ${workerType} worker: ${workerId}`);
    
    // Launch worker asynchronously (fire and forget)
    fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/${functionName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
      },
      body: JSON.stringify({
        workerId,
        maxJobs,
        timeoutMinutes: 10
      })
    }).catch(error => {
      console.error(`Worker ${workerId} failed:`, error);
    });

    return { workerId, workerType, status: 'launched' };
    
  } catch (error) {
    console.error(`Failed to launch ${workerType} worker ${workerId}:`, error);
    return { workerId, workerType, status: 'failed', error: error.message };
  }
}