// Optimized SEO Direct Workflow with reduced duplicate calls - OPTIMIZED VERSION
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
  let jobId = null;
  
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
    
    const { pageId, url, openaiApiKey } = params;
    jobId = params.jobId;
    
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
    
    // Step 1: Insert tracking record directly if we have a job ID
    if (jobId) {
      console.log(`Creating tracking record for job ${jobId}`);
      
      // Get batch_id for the job
      const { data: job, error: jobError } = await supabase
        .from('crawl_jobs')
        .select('batch_id')
        .eq('id', jobId)
        .single();
        
      if (jobError) {
        console.error(`Error fetching job data: ${jobError.message}`);
      } else {
        // Delete any previous failed attempts
        await supabase
          .from('seo_processing_tracking')
          .delete()
          .eq('job_id', jobId)
          .in('success', [false, null]);
        
        // Create new tracking record
        const { data: tracking, error: trackingError } = await supabase
          .from('seo_processing_tracking')
          .insert({
            job_id: jobId,
            batch_id: job.batch_id,
            processing_start: new Date().toISOString(),
          })
          .select('id')
          .single();
          
        if (trackingError) {
          console.error(`Error creating tracking record: ${trackingError.message}`);
        } else {
          trackingId = tracking.id;
          console.log(`Created tracking record ${trackingId}`);
        }
      }
    }
    
    // Step 2: Get or create the page
    let page;
    
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
      // Get page from crawl job
      const { data: job, error: jobError } = await supabase
        .from('crawl_jobs')
        .select('page_id, url, html, html_length')
        .eq('id', jobId)
        .single();
        
      if (jobError) throw new Error(`Error getting job: ${jobError.message}`);
      if (!job) throw new Error(`Job with ID ${jobId} not found`);
      if (!job.page_id) throw new Error(`Job ${jobId} has no associated page_id`);
      
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
    
    // Variables to store results
    let gscSuccessful = false;
    let keywordsExtracted = false;
    let seoAnalysisId = null;
    let seoSuccess = false;
    let errorMessage = null;
    
    // Step 3: Check if we already have keywords for this page
    console.log(`Checking for existing keywords for page ${page.id}`);
    const { data: existingKeywords, error: keywordCheckError } = await supabase
      .from('gsc_keywords')
      .select('count(*)', { count: 'exact' })
      .eq('page_id', page.id);
      
    const keywordCount = existingKeywords?.count || 0;
    console.log(`Found ${keywordCount} existing keywords for page ${page.id}`);
    
    // Helper function to extract keywords from content - only called once if needed
    async function extractKeywordsFromContent() {
      // Skip if we already successfully extracted keywords
      if (keywordsExtracted) {
        console.log(`Skipping duplicate keyword extraction for ${page.url}`);
        return true;
      }
      
      console.log(`Extracting keywords from content for ${page.url}`);
      
      try {
        const keywordResponse = await fetch(`${SUPABASE_URL}/functions/v1/extract-content-keywords`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SUPABASE_KEY}`
          },
          body: JSON.stringify({
            pageId: page.id,
            saveToDatabase: true
          })
        });
        
        const responseText = await keywordResponse.text();
        console.log(`Keyword extraction response status: ${keywordResponse.status}`);
        console.log(`Keyword extraction response preview: ${responseText.substring(0, 200)}...`);
        
        if (keywordResponse.ok) {
          try {
            const keywordResult = JSON.parse(responseText);
            if (keywordResult.success) {
              console.log(`Successfully extracted ${keywordResult.gscCompatibleKeywords?.length || 0} keywords from content`);
              keywordsExtracted = true;
              return true;
            } else {
              console.error(`Keyword extraction reported failure: ${keywordResult.error || 'Unknown error'}`);
              return false;
            }
          } catch (parseError) {
            console.error(`Error parsing keyword extraction response: ${parseError.message}`);
            return false;
          }
        } else {
          console.error(`Error extracting keywords: ${keywordResponse.status} - ${responseText}`);
          return false;
        }
      } catch (keywordError) {
        console.error(`Error calling extract-content-keywords: ${keywordError.message}`);
        return false;
      }
    }
    
    // If we already have keywords, mark as successful
    if (keywordCount > 0) {
      console.log(`Using ${keywordCount} existing keywords for page ${page.id}`);
      gscSuccessful = true;
      keywordsExtracted = true;
    } else {
      // Step 4: Fetch GSC data if we don't already have keywords
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
          
          // If GSC data fetch fails, try to extract keywords from content
          const extractionResult = await extractKeywordsFromContent();
          gscSuccessful = extractionResult;
        } else {
          console.log(`Successfully fetched GSC data for ${page.url}`);
          
          // Check if we actually got any keywords
          const { data: keywordsCheck, error: keywordsError } = await supabase
            .from('gsc_keywords')
            .select('count(*)', { count: 'exact' })
            .eq('page_id', page.id);
            
          const keywordCount = keywordsCheck?.count || 0;
          console.log(`Found ${keywordCount} GSC keywords for page ${page.id}`);
          
          // If no GSC keywords were found, also try AI extraction as a backup
          if (keywordCount === 0) {
            console.log(`No GSC keywords found, trying AI extraction as backup for ${page.url}`);
            const extractionResult = await extractKeywordsFromContent();
            gscSuccessful = extractionResult;
          } else {
            gscSuccessful = true;
            keywordsExtracted = true;
          }
        }
      } catch (error) {
        console.error(`Error calling GSC function: ${error.message}`);
        // Try AI extraction as fallback when GSC API fails completely
        const extractionResult = await extractKeywordsFromContent();
        gscSuccessful = extractionResult;
      }
    }
    
    // Step 5: Run on-page SEO analysis
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
        const errorText = await seoResponse.text();
        errorMessage = `SEO analysis failed: ${seoResponse.status} ${seoResponse.statusText} - ${errorText}`;
        console.error(errorMessage);
      } else {
        console.log(`Successfully analyzed SEO for ${page.url}`);
        const seoResult = await seoResponse.json();
        
        if (seoResult.success && seoResult.analysis && seoResult.analysis.id) {
          seoAnalysisId = seoResult.analysis.id;
          seoSuccess = true;
        }
      }
    } catch (error) {
      errorMessage = `SEO analysis exception: ${error.message}`;
      console.error(errorMessage);
    }
    
    // Step 6: Generate SEO elements (title, h1, h2, paragraph)
    console.log(`Generating SEO elements for ${page.url}`);
    
    try {
      // First try calling the generate-seo-elements-ds function
      let success = false;
      
      try {
        // Call generate-seo-elements-ds function (DeepSeek version with logging)
        const elementsResponse = await fetch(`${SUPABASE_URL}/functions/v1/generate-seo-elements-ds`, {
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
        
        if (!elementsResponse.ok) {
          const errorText = await elementsResponse.text();
          console.error(`SEO elements generation failed: ${elementsResponse.status} ${elementsResponse.statusText} - ${errorText}`);
        } else {
          console.log(`Successfully generated SEO elements for ${page.url}`);
          const elementsResult = await elementsResponse.json();
          
          if (elementsResult.success && elementsResult.seoElements) {
            console.log(`Generated SEO elements: Title, H1, H2, and paragraph`);
            success = true;
          }
        }
      } catch (apiError) {
        console.error(`API call exception: ${apiError.message}`);
      }
      
      // If the API call failed, insert placeholder elements directly
      if (!success) {
        console.log(`Using direct insertion fallback for SEO elements for ${page.url}`);
        
        // Extract domain and path for better title/description
        const urlObj = new URL(page.url);
        const domain = urlObj.hostname.replace('www.', '');
        const path = urlObj.pathname.split('/').filter(p => p).join(' ');
        
        // Create placeholder SEO elements
        const { data: insertResult, error: insertError } = await supabase
          .from('page_seo_recommendations')
          .upsert({
            page_id: page.id,
            url: page.url,
            title: `${path ? path.replace(/-/g, ' ') : 'Products'} | ${domain}`,
            meta_description: `Explore ${path ? path.replace(/-/g, ' ') : 'our products'} at ${domain}. Find great deals on ${urlObj.pathname.split('/').pop()?.replace(/-/g, ' ') || 'items'}.`,
            h1: `${path ? path.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : 'Products'}`,
            h2: `Explore Our ${urlObj.pathname.split('/').pop()?.replace(/-/g, ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || 'Collection'}`,
            paragraph: `Browse our selection of ${path ? path.replace(/-/g, ' ') : 'products'} designed to meet your needs. We offer quality items at competitive prices, with options for every preference and budget.`,
            updated_at: new Date().toISOString()
          }, {
            onConflict: 'page_id'
          })
          .select();
          
        if (insertError) {
          console.error(`Error in direct SEO elements insertion: ${insertError.message}`);
        } else {
          console.log(`Successfully inserted placeholder SEO elements for ${page.url}`);
        }
      }
    } catch (error) {
      console.error(`SEO elements generation exception: ${error.message}`);
    }
    
    // Step 7: Update tracking record if we have one
    if (trackingId) {
      console.log(`Updating tracking record ${trackingId} with success=${seoSuccess}`);
      
      const { error: updateError } = await supabase
        .from('seo_processing_tracking')
        .update({
          processing_end: new Date().toISOString(),
          success: seoSuccess,
          error_message: errorMessage,
          seo_recommendation_id: seoAnalysisId,
          updated_at: new Date().toISOString()
        })
        .eq('id', trackingId);
        
      if (updateError) {
        console.error(`Error updating tracking record: ${updateError.message}`);
      } else {
        console.log(`Successfully updated tracking record`);
      }
    }
    
    return new Response(
      JSON.stringify({
        success: true,
        message: `Successfully ran optimized SEO workflow for ${page.url}`,
        page: {
          id: page.id,
          url: page.url
        },
        seo_analysis_id: seoAnalysisId,
        gsc_fetched: gscSuccessful,
        keywords_extracted: keywordsExtracted,
        tracking_id: trackingId
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    console.error(`Error: ${error.message}`);
    
    // Update tracking record with error
    if (trackingId) {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL') || '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
      );
      
      await supabase
        .from('seo_processing_tracking')
        .update({
          processing_end: new Date().toISOString(),
          success: false,
          error_message: error.message,
          updated_at: new Date().toISOString()
        })
        .eq('id', trackingId);
    }
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        jobId: jobId,
        trackingId: trackingId
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    );
  }
});