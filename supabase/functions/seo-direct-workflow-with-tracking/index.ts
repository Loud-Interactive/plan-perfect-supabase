// SEO Direct Workflow with Job Processing Tracking
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  let trackingId = null;
  
  try {
    // Get Supabase URL and service role key from environment
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
    const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    }
    
    // Parse request body for parameters
    let params = {};
    try {
      params = await req.json();
    } catch (e) {
      params = {};
    }
    
    const { pageId, jobId, url, openaiApiKey } = params;
    
    // We need either pageId, jobId, or url
    if (!pageId && !jobId && !url) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Either pageId, jobId, or url is required'
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400
        }
      );
    }
    
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    
    // Step 1: Get or create the page
    let page;
    let batchId = null;
    
    if (pageId) {
      // Get existing page by ID
      const { data, error } = await supabase
        .from('pages')
        .select('*')
        .eq('id', pageId)
        .single();
        
      if (error) throw new Error(`Error getting page: ${error.message}`);
      if (!data) throw new Error(`Page with ID ${pageId} not found`);
      
      page = data;
    } else if (jobId) {
      // Check if this job has already been processed successfully
      const { data: processedData, error: processedError } = await supabase
        .rpc('has_seo_been_processed', { job_id: jobId });
        
      if (!processedError && processedData === true) {
        console.log(`Job ${jobId} has already been processed successfully. Skipping.`);
        return new Response(
          JSON.stringify({
            success: true,
            message: `Job ${jobId} has already been processed successfully`,
            alreadyProcessed: true
          }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        );
      }
      
      // Get page from crawl job
      const { data: job, error: jobError } = await supabase
        .from('crawl_jobs')
        .select('page_id, url, html, html_length, batch_id')
        .eq('id', jobId)
        .single();
        
      if (jobError) throw new Error(`Error getting job: ${jobError.message}`);
      if (!job) throw new Error(`Job with ID ${jobId} not found`);
      if (!job.page_id) throw new Error(`Job ${jobId} has no associated page_id`);
      
      batchId = job.batch_id;
      
      // Start tracking this job's processing
      const { data: trackingData, error: trackingError } = await supabase
        .rpc('mark_seo_processing_start', { 
          job_id: jobId,
          batch_id: job.batch_id 
        });
        
      if (trackingError) {
        console.error(`Error marking job processing start: ${trackingError.message}`);
      } else {
        trackingId = trackingData;
        console.log(`Created tracking record ${trackingId} for job ${jobId}`);
      }
      
      // Get the page
      const { data: pageData, error: pageError } = await supabase
        .from('pages')
        .select('*')
        .eq('id', job.page_id)
        .single();
        
      if (pageError) throw new Error(`Error getting page: ${pageError.message}`);
      if (!pageData) throw new Error(`Page with ID ${job.page_id} not found`);
      
      page = pageData;
      
      // Update page with HTML if needed
      if (job.html && (!page.html || page.html_length === 0)) {
        const { error: updateError } = await supabase
          .from('pages')
          .update({
            html: job.html,
            html_length: job.html_length,
            last_crawled: new Date().toISOString()
          })
          .eq('id', job.page_id);
          
        if (updateError) {
          console.error(`Error updating page with HTML: ${updateError.message}`);
        }
      }
    } else if (url) {
      // Check if page exists
      const { data: existingPage, error: existingError } = await supabase
        .from('pages')
        .select('*')
        .eq('url', url)
        .single();
        
      if (!existingError && existingPage) {
        page = existingPage;
      } else {
        // Create new page
        const { data: newPage, error: createError } = await supabase
          .from('pages')
          .insert({ url })
          .select()
          .single();
          
        if (createError) throw new Error(`Error creating page: ${createError.message}`);
        
        page = newPage;
      }
    }
    
    console.log(`Working with page ID: ${page.id}, URL: ${page.url}`);
    
    // Step 2: Initialize workflow status record
    const workflowId = crypto.randomUUID();
    
    // Keep it simple - just use required columns
    const insertData = {
      page_id: page.id,
      url: page.url,
      status: 'processing',
      workflow_id: workflowId,
      started_at: new Date().toISOString()
    };
    
    // Insert workflow status record
    const { data: workflow, error: workflowError } = await supabase
      .from('page_perfect_url_status')
      .insert(insertData)
      .select()
      .single();
      
    if (workflowError) {
      console.error(`Error creating workflow status: ${workflowError.message}`);
    }
    
    // Variables to store results IDs
    let gscSuccessful = false;
    let seoAnalysisId = null;
    
    // Step 3: Fetch GSC data
    console.log(`Fetching GSC data for ${page.url}`);
    
    try {
      // Call GSC data function
      const gscResponse = await fetch(`${SUPABASE_URL}/functions/v1/fetch-gsc-data`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_KEY}`
        },
        body: JSON.stringify({
          pageId: page.id,
          url: page.url
        })
      });
      
      if (!gscResponse.ok) {
        console.error(`Error fetching GSC data: ${gscResponse.status} ${gscResponse.statusText}`);
      } else {
        gscSuccessful = true;
        console.log(`Successfully fetched GSC data for ${page.url}`);
      }
    } catch (error) {
      console.error(`Error calling GSC function: ${error.message}`);
    }
    
    // Step 4: Run on-page SEO analysis
    console.log(`Running on-page SEO analysis for ${page.url}`);
    
    try {
      // Call on-page SEO analysis function
      const seoResponse = await fetch(`${SUPABASE_URL}/functions/v1/analyze-page-seo`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_KEY}`
        },
        body: JSON.stringify({
          pageId: page.id,
          url: page.url,
          openaiApiKey
        })
      });
      
      if (!seoResponse.ok) {
        console.error(`Error running SEO analysis: ${seoResponse.status} ${seoResponse.statusText}`);
        
        // Mark job as failed if we're tracking it
        if (trackingId) {
          await supabase.rpc('mark_seo_processing_complete', {
            tracking_id: trackingId,
            success: false,
            error_message: `SEO analysis failed: ${seoResponse.status} ${seoResponse.statusText}`
          });
        }
      } else {
        console.log(`Successfully analyzed SEO for ${page.url}`);
        const seoResult = await seoResponse.json();
        
        if (seoResult.success && seoResult.analysis && seoResult.analysis.id) {
          seoAnalysisId = seoResult.analysis.id;
          
          // Mark job as succeeded if we're tracking it
          if (trackingId) {
            await supabase.rpc('mark_seo_processing_complete', {
              tracking_id: trackingId,
              success: true,
              seo_recommendation_id: seoAnalysisId
            });
          }
        }
      }
    } catch (error) {
      console.error(`Error calling SEO function: ${error.message}`);
      
      // Mark job as failed if we're tracking it
      if (trackingId) {
        await supabase.rpc('mark_seo_processing_complete', {
          tracking_id: trackingId,
          success: false,
          error_message: `SEO analysis exception: ${error.message}`
        });
      }
    }
    
    // Step 5: Update workflow status with basic fields
    const updateData = {
      status: 'completed',
      completed_at: new Date().toISOString()
    };
    
    const { error: updateError } = await supabase
      .from('page_perfect_url_status')
      .update(updateData)
      .eq('workflow_id', workflowId);
      
    if (updateError) {
      console.error(`Error updating workflow status: ${updateError.message}`);
    }
    
    // If we're processing a batch, check and update batch status
    if (batchId && seoAnalysisId) {
      // Get current stats for the batch
      const { data: batchStats, error: statsError } = await supabase
        .rpc('get_seo_processing_stats', { batch_id: batchId });
        
      if (!statsError) {
        console.log(`Batch ${batchId} stats: ${JSON.stringify(batchStats)}`);
      }
    }
    
    return new Response(
      JSON.stringify({
        success: true,
        message: `Successfully ran streamlined SEO workflow for ${page.url}`,
        page: {
          id: page.id,
          url: page.url
        },
        seo_analysis_id: seoAnalysisId,
        gsc_fetched: gscSuccessful,
        workflowId
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    console.error(`Error: ${error.message}`);
    
    // Mark job as failed if we're tracking it
    if (trackingId) {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL') || '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
      );
      
      await supabase.rpc('mark_seo_processing_complete', {
        tracking_id: trackingId,
        success: false,
        error_message: error.message
      });
    }
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    );
  }
});