// supabase/functions/utils/error-handling.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * Centralized error logging function that records errors in console
 * and in the error_logs table.
 * 
 * @param functionName Name of the function where error occurred
 * @param jobId Job ID associated with the error (if applicable)
 * @param error The error object
 * @param context Additional context data for debugging
 */
export async function logError(
  functionName: string, 
  jobId: string | null, 
  error: Error, 
  context: Record<string, any> = {}
) {
  const errorDetail = {
    function: functionName,
    job_id: jobId,
    error_message: error.message,
    error_stack: error.stack,
    context,
    timestamp: new Date().toISOString()
  };
  
  // Always log to console for serverless function logs
  console.error(JSON.stringify(errorDetail));
  
  // Try to record in database if possible
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Missing Supabase credentials, cannot log to database');
      return;
    }
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    await supabase
      .from('error_logs')
      .insert({
        function_name: functionName,
        job_id: jobId,
        error_message: error.message,
        error_stack: error.stack,
        context_data: context,
        created_at: new Date().toISOString()
      });
  } catch (logError) {
    // If logging to DB fails, at least we logged to console
    console.error('Failed to record error in database:', logError);
  }
}

/**
 * Utility function to retry an operation with exponential backoff
 * 
 * @param operation Function to retry
 * @param maxRetries Maximum number of retry attempts
 * @param initialDelay Initial delay in milliseconds
 * @returns The result of the operation
 * @throws The last error if all retries fail
 */
export async function retryWithBackoff<T>(
  operation: () => Promise<T>, 
  maxRetries = 3, 
  initialDelay = 1000
): Promise<T> {
  let retryCount = 0;
  let lastError: Error;
  
  while (retryCount < maxRetries) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      retryCount++;
      
      // Log retry attempt
      console.log(`Retry attempt ${retryCount}/${maxRetries} after error: ${error.message}`);
      
      // Skip retry if it's a non-recoverable error
      if (isNonRecoverableError(error)) {
        console.log('Non-recoverable error, aborting retries');
        throw error;
      }
      
      // Exponential backoff delay with jitter
      const delay = Math.pow(2, retryCount) * initialDelay * (0.9 + Math.random() * 0.2);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  // If all retries failed, throw the last error
  throw lastError;
}

/**
 * Determines if an error is non-recoverable (i.e., retrying won't help)
 */
function isNonRecoverableError(error: Error): boolean {
  const message = error.message.toLowerCase();
  
  return (
    message.includes('invalid parameters') || 
    message.includes('access denied') ||
    message.includes('not found') ||
    message.includes('unauthorized') ||
    message.includes('permission') ||
    message.includes('invalid token')
  );
}

/**
 * Adds a timeout to a promise
 * 
 * @param promise The promise to add timeout to
 * @param timeoutMs Timeout in milliseconds
 * @param timeoutMessage Custom timeout message
 * @returns Promise with timeout
 */
export function withTimeout<T>(
  promise: Promise<T>, 
  timeoutMs: number, 
  timeoutMessage = 'Operation timed out'
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });
  
  return Promise.race([promise, timeoutPromise]);
}

/**
 * Updates the heartbeat timestamp for a job
 * 
 * @param jobId The job ID to update
 * @returns A promise that resolves when the heartbeat is updated
 */
export async function updateJobHeartbeat(jobId: string): Promise<void> {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Missing Supabase credentials, cannot update heartbeat');
      return;
    }
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    await supabase
      .from('outline_generation_jobs')
      .update({ 
        heartbeat_at: new Date().toISOString()
      })
      .eq('id', jobId);
  } catch (error) {
    console.error(`Failed to update heartbeat for job ${jobId}:`, error);
  }
}

/**
 * Sets up a recurring heartbeat interval for a job
 * 
 * @param jobId The job ID to update heartbeats for
 * @param intervalMs Interval between heartbeats in milliseconds
 * @returns A function that can be called to stop the heartbeat
 */
export function setupHeartbeat(jobId: string, intervalMs = 30000): () => void {
  // First heartbeat immediately
  updateJobHeartbeat(jobId).catch(console.error);
  
  // Set up recurring heartbeat
  const intervalId = setInterval(() => {
    updateJobHeartbeat(jobId).catch(console.error);
  }, intervalMs);
  
  // Return function to stop heartbeat
  return () => clearInterval(intervalId);
}

/**
 * Saves a checkpoint for a job
 * 
 * @param jobId The job ID
 * @param checkpointName Unique name for this checkpoint
 * @param data Checkpoint data to save
 */
export async function saveCheckpoint(
  jobId: string, 
  checkpointName: string, 
  data: Record<string, any> = {}
): Promise<void> {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Missing Supabase credentials, cannot save checkpoint');
      return;
    }
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Upsert to handle duplicate checkpoint names
    const { error } = await supabase
      .from('job_checkpoints')
      .upsert({
        job_id: jobId,
        checkpoint_name: checkpointName,
        checkpoint_data: data
      }, {
        onConflict: 'job_id,checkpoint_name',
        update: ['checkpoint_data', 'created_at']
      });
      
    if (error) throw error;
    console.log(`Saved checkpoint '${checkpointName}' for job ${jobId}`);
  } catch (error) {
    console.error(`Failed to save checkpoint:`, error);
  }
}

/**
 * Loads a checkpoint for a job
 * 
 * @param jobId The job ID
 * @param checkpointName Name of checkpoint to load
 * @returns The checkpoint data or null if not found
 */
export async function loadCheckpoint(
  jobId: string, 
  checkpointName: string
): Promise<Record<string, any> | null> {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Missing Supabase credentials, cannot load checkpoint');
      return null;
    }
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    const { data, error } = await supabase
      .from('job_checkpoints')
      .select('checkpoint_data')
      .eq('job_id', jobId)
      .eq('checkpoint_name', checkpointName)
      .single();
      
    if (error) return null;
    return data?.checkpoint_data || null;
  } catch (error) {
    console.error(`Failed to load checkpoint:`, error);
    return null;
  }
}