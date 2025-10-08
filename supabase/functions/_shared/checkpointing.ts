// Checkpoint System - Enables job resumption and progress tracking
// Provides ability to save and restore job state at any point

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface CheckpointData {
  stage: string;
  progress: {
    pages_discovered: number;
    pages_crawled: number;
    pages_failed: number;
    analyses_completed: string[];
    analyses_failed: string[];
    partial_results: Record<string, any>;
  };
  metadata: {
    last_successful_operation?: string;
    last_error?: string;
    retry_count?: number;
    quality_metrics?: {
      pages_quality: number;
      analyses_quality: number;
    };
  };
  timestamp: string;
  version: string;
}

export interface ResumableState {
  canResume: boolean;
  fromStage?: string;
  checkpointAge?: number;
  reason?: string;
}

export class CheckpointManager {
  private readonly CHECKPOINT_VERSION = '1.0';
  private readonly MAX_CHECKPOINT_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
  
  constructor(private supabase: SupabaseClient) {}

  /**
   * Save a checkpoint for a job
   */
  async saveCheckpoint(
    jobId: string, 
    stage: string,
    progress: CheckpointData['progress'],
    metadata?: CheckpointData['metadata']
  ): Promise<void> {
    try {
      const checkpoint: CheckpointData = {
        stage,
        progress,
        metadata: metadata || {},
        timestamp: new Date().toISOString(),
        version: this.CHECKPOINT_VERSION
      };

      const { error } = await this.supabase
        .from('synopsis_jobs')
        .update({
          checkpoint_data: checkpoint,
          last_checkpoint_at: checkpoint.timestamp,
          updated_at: checkpoint.timestamp
        })
        .eq('id', jobId);

      if (error) {
        throw new Error(`Failed to save checkpoint: ${error.message}`);
      }

      console.log(`Checkpoint saved for job ${jobId} at stage: ${stage}`);
    } catch (error) {
      console.error(`Error saving checkpoint for job ${jobId}:`, error);
      // Don't throw - checkpointing failure shouldn't stop job processing
    }
  }

  /**
   * Load the most recent checkpoint for a job
   */
  async loadCheckpoint(jobId: string): Promise<CheckpointData | null> {
    try {
      const { data, error } = await this.supabase
        .from('synopsis_jobs')
        .select('checkpoint_data, last_checkpoint_at')
        .eq('id', jobId)
        .single();

      if (error || !data?.checkpoint_data) {
        return null;
      }

      const checkpoint = data.checkpoint_data as CheckpointData;
      
      // Validate checkpoint version
      if (checkpoint.version !== this.CHECKPOINT_VERSION) {
        console.warn(`Checkpoint version mismatch for job ${jobId}: ${checkpoint.version} vs ${this.CHECKPOINT_VERSION}`);
        return null;
      }

      return checkpoint;
    } catch (error) {
      console.error(`Error loading checkpoint for job ${jobId}:`, error);
      return null;
    }
  }

  /**
   * Check if a job can be resumed from its checkpoint
   */
  async canResumeFrom(jobId: string): Promise<ResumableState> {
    try {
      const checkpoint = await this.loadCheckpoint(jobId);
      
      if (!checkpoint) {
        return { 
          canResume: false, 
          reason: 'No checkpoint found' 
        };
      }

      // Check checkpoint age
      const checkpointAge = Date.now() - new Date(checkpoint.timestamp).getTime();
      
      if (checkpointAge > this.MAX_CHECKPOINT_AGE_MS) {
        return {
          canResume: false,
          checkpointAge,
          reason: `Checkpoint too old: ${Math.round(checkpointAge / 1000 / 60 / 60)} hours`
        };
      }

      // Check if job is in a resumable state
      const { data: job } = await this.supabase
        .from('synopsis_jobs')
        .select('status')
        .eq('id', jobId)
        .single();

      if (!job || job.status === 'completed') {
        return {
          canResume: false,
          reason: 'Job already completed'
        };
      }

      // Validate checkpoint data integrity
      if (!this.isValidCheckpoint(checkpoint)) {
        return {
          canResume: false,
          reason: 'Invalid checkpoint data'
        };
      }

      return {
        canResume: true,
        fromStage: checkpoint.stage,
        checkpointAge
      };

    } catch (error) {
      console.error(`Error checking resume capability for job ${jobId}:`, error);
      return {
        canResume: false,
        reason: `Error: ${error.message}`
      };
    }
  }

  /**
   * Resume a job from its checkpoint
   */
  async resumeFromCheckpoint(jobId: string): Promise<CheckpointData | null> {
    const resumableState = await this.canResumeFrom(jobId);
    
    if (!resumableState.canResume) {
      console.log(`Cannot resume job ${jobId}: ${resumableState.reason}`);
      return null;
    }

    const checkpoint = await this.loadCheckpoint(jobId);
    if (!checkpoint) return null;

    console.log(`Resuming job ${jobId} from stage: ${checkpoint.stage}`);
    console.log(`Progress: ${checkpoint.progress.pages_crawled} pages, ${checkpoint.progress.analyses_completed.length} analyses`);

    // Update job status to indicate resumption
    await this.supabase
      .from('synopsis_jobs')
      .update({
        status: 'processing',
        updated_at: new Date().toISOString(),
        error_message: null
      })
      .eq('id', jobId);

    return checkpoint;
  }

  /**
   * Clear checkpoint data for a job
   */
  async clearCheckpoint(jobId: string): Promise<void> {
    try {
      await this.supabase
        .from('synopsis_jobs')
        .update({
          checkpoint_data: null,
          last_checkpoint_at: null
        })
        .eq('id', jobId);

      console.log(`Checkpoint cleared for job ${jobId}`);
    } catch (error) {
      console.error(`Error clearing checkpoint for job ${jobId}:`, error);
    }
  }

  /**
   * Create checkpoint from current job state
   */
  async createCheckpointFromJobState(jobId: string, stage: string): Promise<CheckpointData> {
    // Get page tasks status
    const { data: pageTasks } = await this.supabase
      .from('synopsis_page_tasks')
      .select('status, url')
      .eq('job_id', jobId);

    const pagesCrawled = pageTasks?.filter(t => t.status === 'completed').length || 0;
    const pagesFailed = pageTasks?.filter(t => t.status === 'failed').length || 0;
    const pagesDiscovered = pageTasks?.length || 0;

    // Get analysis tasks status
    const { data: analysisTasks } = await this.supabase
      .from('synopsis_analysis_tasks')
      .select('analysis_type, status, partial_response')
      .eq('job_id', jobId);

    const analysesCompleted = analysisTasks
      ?.filter(t => t.status === 'completed')
      .map(t => t.analysis_type) || [];
    
    const analysesFailed = analysisTasks
      ?.filter(t => t.status === 'failed')
      .map(t => t.analysis_type) || [];

    // Collect partial results
    const partialResults: Record<string, any> = {};
    analysisTasks
      ?.filter(t => t.partial_response)
      .forEach(t => {
        partialResults[t.analysis_type] = t.partial_response;
      });

    const checkpoint: CheckpointData = {
      stage,
      progress: {
        pages_discovered: pagesDiscovered,
        pages_crawled: pagesCrawled,
        pages_failed: pagesFailed,
        analyses_completed: analysesCompleted,
        analyses_failed: analysesFailed,
        partial_results: partialResults
      },
      metadata: {
        quality_metrics: {
          pages_quality: pagesCrawled / Math.max(1, pagesDiscovered),
          analyses_quality: analysesCompleted.length / 17
        }
      },
      timestamp: new Date().toISOString(),
      version: this.CHECKPOINT_VERSION
    };

    return checkpoint;
  }

  /**
   * Get checkpoint statistics for monitoring
   */
  async getCheckpointStats(): Promise<{
    totalJobs: number;
    jobsWithCheckpoints: number;
    resumableJobs: number;
    averageProgress: number;
  }> {
    const { data: jobs } = await this.supabase
      .from('synopsis_jobs')
      .select('id, checkpoint_data, status')
      .not('checkpoint_data', 'is', null);

    const totalJobs = jobs?.length || 0;
    let resumableCount = 0;
    let totalProgress = 0;

    for (const job of jobs || []) {
      const resumable = await this.canResumeFrom(job.id);
      if (resumable.canResume) resumableCount++;

      const checkpoint = job.checkpoint_data as CheckpointData;
      if (checkpoint?.progress) {
        const progress = checkpoint.progress.analyses_completed.length / 17;
        totalProgress += progress;
      }
    }

    return {
      totalJobs: await this.getTotalJobCount(),
      jobsWithCheckpoints: totalJobs,
      resumableJobs: resumableCount,
      averageProgress: totalJobs > 0 ? totalProgress / totalJobs : 0
    };
  }

  private async getTotalJobCount(): Promise<number> {
    const { count } = await this.supabase
      .from('synopsis_jobs')
      .select('*', { count: 'exact', head: true });
    return count || 0;
  }

  private isValidCheckpoint(checkpoint: CheckpointData): boolean {
    return !!(
      checkpoint.stage &&
      checkpoint.progress &&
      typeof checkpoint.progress.pages_discovered === 'number' &&
      typeof checkpoint.progress.pages_crawled === 'number' &&
      Array.isArray(checkpoint.progress.analyses_completed) &&
      checkpoint.timestamp &&
      checkpoint.version
    );
  }
}

// Helper function to create safe checkpoints during processing
export async function createSafeCheckpoint(
  checkpointManager: CheckpointManager,
  jobId: string,
  stage: string,
  operation: () => Promise<void>
): Promise<void> {
  try {
    // Create checkpoint before operation
    const checkpoint = await checkpointManager.createCheckpointFromJobState(jobId, stage);
    await checkpointManager.saveCheckpoint(
      jobId,
      stage,
      checkpoint.progress,
      {
        ...checkpoint.metadata,
        last_successful_operation: `Before ${stage}`
      }
    );

    // Execute operation
    await operation();

    // Update checkpoint after successful operation
    const newCheckpoint = await checkpointManager.createCheckpointFromJobState(jobId, stage);
    await checkpointManager.saveCheckpoint(
      jobId,
      stage,
      newCheckpoint.progress,
      {
        ...newCheckpoint.metadata,
        last_successful_operation: `Completed ${stage}`
      }
    );

  } catch (error) {
    // Save error in checkpoint
    const errorCheckpoint = await checkpointManager.createCheckpointFromJobState(jobId, stage);
    await checkpointManager.saveCheckpoint(
      jobId,
      stage,
      errorCheckpoint.progress,
      {
        ...errorCheckpoint.metadata,
        last_error: error.message,
        last_successful_operation: `Failed at ${stage}`
      }
    );
    throw error;
  }
}