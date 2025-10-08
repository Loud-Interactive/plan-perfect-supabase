// PagePerfect 2.0: Batch Monitor
// Monitors batch progress and provides real-time status updates

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface MonitorRequest {
  batchId: string;
  detailed?: boolean;
}

interface BatchStatus {
  batchId: string;
  name: string;
  totalUrls: number;
  processedUrls: number;
  failedUrls: number;
  status: string;
  createdAt: string;
  completedAt?: string;
  progress: {
    crawling: StageProgress;
    gscData: StageProgress;
    seoAnalysis: StageProgress;
    seoGeneration: StageProgress;
    overall: StageProgress;
  };
  performance?: {
    avgDurationSeconds?: number;
    urlsPerMinute?: number;
    successRate?: number;
  };
  recentActivity?: RecentActivity[];
}

interface StageProgress {
  completed: number;
  failed: number;
  inProgress: number;
  total: number;
  percentage: number;
}

interface RecentActivity {
  url: string;
  status: 'success' | 'failed' | 'processing';
  stage: string;
  timestamp: string;
  error?: string;
}

serve(async (req) => {
  // Handle CORS preflight request
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Create Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase configuration');
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Parse request
    const { batchId, detailed = false } = await req.json() as MonitorRequest;

    if (!batchId) {
      throw new Error('Batch ID is required');
    }

    console.log(`Monitoring batch ${batchId} (detailed: ${detailed})`);

    // Get batch job details
    const { data: batchJob, error: batchError } = await supabase
      .from('pp_batch_jobs')
      .select('*')
      .eq('id', batchId)
      .single();

    if (batchError || !batchJob) {
      throw new Error(`Batch not found: ${batchError?.message || 'Unknown error'}`);
    }

    // Get progress by analyzing seo_processing_tracking
    const { data: trackingData, error: trackingError } = await supabase
      .from('seo_processing_tracking')
      .select(`
        id,
        job_id,
        processing_start,
        processing_end,
        success,
        error_message,
        crawl_jobs!inner(
          page_id,
          url,
          status
        )
      `)
      .eq('pp_batch_id', batchId);

    if (trackingError) {
      console.error('Error fetching tracking data:', trackingError);
    }

    const tracking = trackingData || [];

    // Calculate stage progress
    const progress = calculateProgress(tracking);

    // Get performance metrics
    let performance: BatchStatus['performance'] = undefined;
    if (tracking.length > 0) {
      const completedJobs = tracking.filter(t => t.processing_end !== null);
      if (completedJobs.length > 0) {
        const durations = completedJobs.map(t => {
          const start = new Date(t.processing_start).getTime();
          const end = new Date(t.processing_end!).getTime();
          return (end - start) / 1000; // seconds
        });

        const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
        const elapsedMinutes = (Date.now() - new Date(batchJob.created_at).getTime()) / 1000 / 60;
        const urlsPerMinute = completedJobs.length / elapsedMinutes;
        const successRate = (tracking.filter(t => t.success === true).length / tracking.length) * 100;

        performance = {
          avgDurationSeconds: Math.round(avgDuration),
          urlsPerMinute: Math.round(urlsPerMinute * 10) / 10,
          successRate: Math.round(successRate * 10) / 10
        };
      }
    }

    // Get recent activity if detailed
    let recentActivity: RecentActivity[] = [];
    if (detailed && tracking.length > 0) {
      // Get last 10 activities
      const sortedTracking = [...tracking]
        .sort((a, b) => {
          const timeA = new Date(a.processing_end || a.processing_start).getTime();
          const timeB = new Date(b.processing_end || b.processing_start).getTime();
          return timeB - timeA;
        })
        .slice(0, 10);

      recentActivity = sortedTracking.map(t => ({
        url: t.crawl_jobs.url,
        status: t.processing_end === null ? 'processing' : (t.success ? 'success' : 'failed'),
        stage: getStageFromTracking(t),
        timestamp: t.processing_end || t.processing_start,
        error: t.error_message || undefined
      }));
    }

    // Build response
    const response: BatchStatus = {
      batchId: batchJob.id,
      name: batchJob.name,
      totalUrls: batchJob.total_urls,
      processedUrls: batchJob.processed_urls,
      failedUrls: batchJob.failed_urls,
      status: batchJob.status,
      createdAt: batchJob.created_at,
      completedAt: batchJob.completed_at || undefined,
      progress,
      performance,
      recentActivity: detailed ? recentActivity : undefined
    };

    // Update batch progress in database
    await updateBatchProgress(supabase, batchId, progress);

    return new Response(
      JSON.stringify({
        success: true,
        data: response
      }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );

  } catch (error) {
    console.error('Error in pp-batch-monitor:', error);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
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

function calculateProgress(tracking: any[]): BatchStatus['progress'] {
  const total = tracking.length;
  
  // Count by status
  const completed = tracking.filter(t => t.success === true).length;
  const failed = tracking.filter(t => t.success === false).length;
  const inProgress = tracking.filter(t => t.processing_end === null).length;

  // For stage breakdown, we need to analyze what's been done
  // This is a simplified version - in production, you might want to track
  // individual stage completions more granularly
  const crawlingComplete = tracking.filter(t => t.crawl_jobs?.status === 'complete').length;
  const hasGscData = tracking.filter(t => t.success === true || t.processing_end !== null).length;
  const seoAnalysisComplete = tracking.filter(t => t.success === true).length;
  const seoGenerationComplete = tracking.filter(t => t.success === true).length;

  return {
    crawling: {
      completed: crawlingComplete,
      failed: 0,
      inProgress: Math.max(0, total - crawlingComplete),
      total,
      percentage: total > 0 ? Math.round((crawlingComplete / total) * 100) : 0
    },
    gscData: {
      completed: hasGscData,
      failed: 0,
      inProgress: Math.max(0, crawlingComplete - hasGscData),
      total: crawlingComplete,
      percentage: crawlingComplete > 0 ? Math.round((hasGscData / crawlingComplete) * 100) : 0
    },
    seoAnalysis: {
      completed: seoAnalysisComplete,
      failed: 0,
      inProgress: Math.max(0, hasGscData - seoAnalysisComplete),
      total: hasGscData,
      percentage: hasGscData > 0 ? Math.round((seoAnalysisComplete / hasGscData) * 100) : 0
    },
    seoGeneration: {
      completed: seoGenerationComplete,
      failed: 0,
      inProgress: Math.max(0, seoAnalysisComplete - seoGenerationComplete),
      total: seoAnalysisComplete,
      percentage: seoAnalysisComplete > 0 ? Math.round((seoGenerationComplete / seoAnalysisComplete) * 100) : 0
    },
    overall: {
      completed,
      failed,
      inProgress,
      total,
      percentage: total > 0 ? Math.round((completed / total) * 100) : 0
    }
  };
}

function getStageFromTracking(tracking: any): string {
  if (tracking.processing_end === null) {
    return 'processing';
  }
  if (tracking.success === false) {
    return 'failed';
  }
  // In a real implementation, you might check specific fields to determine
  // which stage was completed
  return 'seo_generation';
}

async function updateBatchProgress(
  supabase: any, 
  batchId: string, 
  progress: BatchStatus['progress']
) {
  try {
    // Update overall batch stats
    await supabase.rpc('update_batch_job_stats', { p_batch_id: batchId });

    // Update stage progress
    const stages = [
      { stage: 'crawling', ...progress.crawling },
      { stage: 'gsc_data', ...progress.gscData },
      { stage: 'seo_analysis', ...progress.seoAnalysis },
      { stage: 'seo_generation', ...progress.seoGeneration },
      { stage: 'completed', completed: progress.overall.completed, failed: progress.overall.failed, in_progress: 0 }
    ];

    for (const stageData of stages) {
      const { stage, completed, failed, inProgress } = stageData;
      
      await supabase
        .from('pp_batch_progress')
        .upsert({
          batch_id: batchId,
          stage,
          completed,
          failed,
          in_progress: inProgress || 0,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'batch_id,stage'
        });
    }
  } catch (error) {
    console.error('Error updating batch progress:', error);
  }
}