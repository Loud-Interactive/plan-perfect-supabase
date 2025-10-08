// PagePerfect: crawl-cron
// Cron job to process pending crawl jobs
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

serve(async (req) => {
  try {
    // Get the Supabase URL and service role key from environment variables
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set');
    }
    
    console.log('Starting crawl-cron job to process pending jobs');
    
    // Call the process-crawl-jobs function to process pending crawl jobs
    const response = await fetch(`${supabaseUrl}/functions/v1/process-crawl-jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseKey}`
      },
      body: JSON.stringify({
        batchSize: 5 // Process up to 5 jobs at a time
      })
    });
    
    if (!response.ok) {
      throw new Error(`Failed to process crawl jobs: ${response.status} ${response.statusText}`);
    }
    
    const result = await response.json();
    
    return new Response(
      JSON.stringify({
        success: true,
        message: 'Crawl cron job executed successfully',
        result
      }),
      {
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    console.error(`Error in crawl-cron: ${error.message}`);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message
      }),
      {
        headers: { 'Content-Type': 'application/json' },
        status: 500
      }
    );
  }
});