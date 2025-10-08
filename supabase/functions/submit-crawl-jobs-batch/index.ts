// PagePerfect: submit-crawl-jobs-batch
// Function to submit multiple crawl jobs in one batch
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  urls: string[];
  premium?: boolean;
  ultraPremium?: boolean;
  render?: boolean;
  batchId?: string; // Optional custom batch ID
  autoPagePerfectWorkflow?: boolean; // Whether to auto-trigger the PagePerfect workflow after crawl
}

serve(async (req) => {
  // Handle CORS preflight requests
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
      urls, 
      premium = false, 
      ultraPremium = true, 
      render = true, 
      batchId = `batch-${Date.now()}`,
      autoPagePerfectWorkflow = false 
    } = await req.json() as RequestBody;

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      throw new Error('At least one URL is required');
    }

    console.log(`Submitting ${urls.length} crawl jobs in batch ${batchId}`);

    // Create a jobs array to store information about all jobs
    const jobs = [];
    
    // Submit each URL as a separate job
    for (const url of urls) {
      try {
        // Skip empty URLs
        if (!url || url.trim() === '') {
          continue;
        }
        
        // Clean URL
        const cleanUrl = url.trim();
        
        // Find or create a page for this URL
        let pageId: string;
        
        // Check if page already exists
        const { data: existingPage } = await supabaseClient
          .from('pages')
          .select('id')
          .eq('url', cleanUrl)
          .maybeSingle();
        
        if (existingPage) {
          pageId = existingPage.id;
        } else {
          // Create a new page
          const { data: newPage, error } = await supabaseClient
            .from('pages')
            .insert({ url: cleanUrl })
            .select('id')
            .single();
            
          if (error) {
            throw new Error(`Failed to create page for ${cleanUrl}: ${error.message}`);
          }
          
          pageId = newPage.id;
        }

        // Create a new crawl job
        const { data: job, error } = await supabaseClient
          .from('crawl_jobs')
          .insert({
            url: cleanUrl,
            page_id: pageId,
            status: 'pending',
            premium,
            ultra_premium: ultraPremium,
            render,
            batch_id: batchId,
            auto_workflow: autoPagePerfectWorkflow
          })
          .select()
          .single();
          
        if (error) {
          throw new Error(`Failed to create crawl job for ${cleanUrl}: ${error.message}`);
        }
        
        // Add job to list
        jobs.push({
          jobId: job.id,
          url: job.url,
          status: job.status,
          pageId: job.page_id
        });
      } catch (error) {
        console.error(`Error submitting job for ${url}: ${error.message}`);
        
        // Add failed job to list
        jobs.push({
          url,
          error: error.message,
          status: 'failed'
        });
      }
    }
    
    // Return success response
    return new Response(
      JSON.stringify({
        success: true,
        message: `Submitted ${jobs.length} crawl jobs`,
        batchId,
        jobs,
        total: jobs.length,
        successCount: jobs.filter(job => job.status === 'pending').length,
        failedCount: jobs.filter(job => job.status === 'failed').length
      }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error) {
    console.error(`Error: ${error.message}`);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    );
  }
});