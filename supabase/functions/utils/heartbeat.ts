// supabase/functions/utils/heartbeat.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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
    
    const now = new Date().toISOString();
    
    await supabase
      .from('outline_generation_jobs')
      .update({ 
        heartbeat_at: now
      })
      .eq('id', jobId);
      
    console.log(`Updated heartbeat for job ${jobId} at ${now}`);
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
  console.log(`Setting up heartbeat for job ${jobId} with interval ${intervalMs}ms`);
  
  // First heartbeat immediately
  updateJobHeartbeat(jobId).catch(console.error);
  
  // Set up recurring heartbeat
  const intervalId = setInterval(() => {
    updateJobHeartbeat(jobId).catch(console.error);
  }, intervalMs);
  
  // Return function to stop heartbeat
  return () => {
    console.log(`Stopping heartbeat for job ${jobId}`);
    clearInterval(intervalId);
  };
}

/**
 * Increments the attempts counter for a job
 * 
 * @param jobId The job ID to update
 * @returns A promise that resolves when the attempts counter is updated
 */
export async function incrementJobAttempts(jobId: string): Promise<void> {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Missing Supabase credentials, cannot increment attempts');
      return;
    }
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    await supabase
      .from('outline_generation_jobs')
      .update({ 
        attempts: supabase.sql`attempts + 1`,
        updated_at: new Date().toISOString()
      })
      .eq('id', jobId);
      
    // Get the current attempts count for logging
    const { data } = await supabase
      .from('outline_generation_jobs')
      .select('attempts')
      .eq('id', jobId)
      .single();
      
    console.log(`Incremented attempts for job ${jobId} to ${data?.attempts}`);
  } catch (error) {
    console.error(`Failed to increment attempts for job ${jobId}:`, error);
  }
}