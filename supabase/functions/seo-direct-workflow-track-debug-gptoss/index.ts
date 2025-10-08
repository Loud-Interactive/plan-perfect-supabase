// GPT-OSS version of SEO Direct Workflow with enhanced error logging
// Uses Groq's GPT-OSS-120B model instead of DeepSeek
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
      console.error(`Error parsing request body: ${e.message}`);
      params = {};
    }
    
    const { pageId, url, openaiApiKey, pp_batch_id } = params;
    jobId = params.jobId;

    console.log(`Debug mode: Received request with jobId=${jobId}, pageId=${pageId}, url=${url}, pp_batch_id=${pp_batch_id}`);
    
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

    // If jobId is provided, first validate it exists
    if (jobId) {
      console.log(`Debug: Validating job ID ${jobId}`);
      const { data: jobData, error: jobLookupError } = await supabase
        .from('crawl_jobs')
        .select('id, page_id, url, status')
        .eq('id', jobId)
        .single();
        
      if (jobLookupError) {
        console.error(`Debug: Error looking up job: ${jobLookupError.message}`);
        throw new Error(`Job lookup failed: ${jobLookupError.message}`);
      }
      
      if (!jobData) {
        console.error(`Debug: Job with ID ${jobId} not found`);
        throw new Error(`Job with ID ${jobId} not found`);
      }
      
      console.log(`Debug: Found job with status ${jobData.status}, page_id=${jobData.page_id}, url=${jobData.url}`);
    }
    
    // Step 1: Insert tracking record directly if we have a job ID
    if (jobId) {
      console.log(`Debug: Creating tracking record for job ${jobId}`);
      
      try {
        // Get batch_id for the job
        const { data: job, error: jobError } = await supabase
          .from('crawl_jobs')
          .select('batch_id, page_id, url')
          .eq('id', jobId)
          .single();
          
        if (jobError) {
          console.error(`Debug: Error fetching job data: ${jobError.message}`);
          throw new Error(`Error fetching job data: ${jobError.message}`);
        }
        
        if (!job) {
          console.error(`Debug: Job with ID ${jobId} not found`);
          throw new Error(`Job with ID ${jobId} not found`);
        }
        
        console.log(`Debug: Job has batch_id=${job.batch_id}, page_id=${job.page_id}, url=${job.url}`);
        
        // Delete any previous failed attempts
        const { error: deleteError } = await supabase
          .from('seo_processing_tracking')
          .delete()
          .eq('job_id', jobId)
          .in('success', [false, null]);
          
        if (deleteError) {
          console.error(`Debug: Error deleting previous tracking records: ${deleteError.message}`);
        }
        
        // Create new tracking record
        const { data: tracking, error: trackingError } = await supabase
          .from('seo_processing_tracking')
          .insert({
            job_id: jobId,
            batch_id: job.batch_id,
            pp_batch_id: pp_batch_id || null,
            processing_start: new Date().toISOString(),
          })
          .select('id')
          .single();
          
        if (trackingError) {
          console.error(`Debug: Error creating tracking record: ${trackingError.message}`);
          throw new Error(`Error creating tracking record: ${trackingError.message}`);
        }
        
        trackingId = tracking.id;
        console.log(`Debug: Created tracking record ${trackingId}`);
      } catch (trackingError) {
        console.error(`Debug: Error in tracking setup: ${trackingError.message}`);
        throw new Error(`Tracking setup failed: ${trackingError.message}`);
      }
    }
    
    // Step 2: Get or create the page
    let page;
    
    try {
      if (pageId) {
        // Get existing page by ID
        const { data, error } = await supabase
          .from('pages')
          .select('*')
          .eq('id', pageId)
          .single();
          
        if (error) {
          console.error(`Debug: Error getting page by ID: ${error.message}`);
          throw new Error(`Error getting page: ${error.message}`);
        }
        
        if (!data) {
          console.error(`Debug: Page with ID ${pageId} not found`);
          throw new Error(`Page with ID ${pageId} not found`);
        }
        
        page = data;
      } else if (jobId) {
        // Get page from crawl job
        const { data: job, error: jobError } = await supabase
          .from('crawl_jobs')
          .select('page_id, url, html, html_length')
          .eq('id', jobId)
          .single();
          
        if (jobError) {
          console.error(`Debug: Error getting job for page lookup: ${jobError.message}`);
          throw new Error(`Error getting job: ${jobError.message}`);
        }
        
        if (!job) {
          console.error(`Debug: Job with ID ${jobId} not found during page lookup`);
          throw new Error(`Job with ID ${jobId} not found`);
        }
        
        if (!job.page_id) {
          console.error(`Debug: Job ${jobId} has no associated page_id`);
          throw new Error(`Job ${jobId} has no associated page_id`);
        }
        
        // Get the page
        const { data: pageData, error: pageError } = await supabase
          .from('pages')
          .select('*')
          .eq('id', job.page_id)
          .single();
          
        if (pageError) {
          console.error(`Debug: Error getting page from job: ${pageError.message}`);
          throw new Error(`Error getting page: ${pageError.message}`);
        }
        
        if (!pageData) {
          console.error(`Debug: Page with ID ${job.page_id} from job not found`);
          throw new Error(`Page with ID ${job.page_id} not found`);
        }
        
        page = pageData;
        
        // Update page with HTML if needed
        if (job.html && (!page.html || page.html_length === 0)) {
          console.log(`Debug: Updating page with HTML from job, html_length=${job.html_length}`);
          
          const { error: updateError } = await supabase
            .from('pages')
            .update({
              html: job.html,
              html_length: job.html_length,
              last_crawled: new Date().toISOString()
            })
            .eq('id', job.page_id);
            
          if (updateError) {
            console.error(`Debug: Error updating page with HTML: ${updateError.message}`);
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
          console.log(`Debug: Found existing page for URL ${url}, id=${page.id}`);
        } else {
          // Create new page
          console.log(`Debug: Creating new page for URL ${url}`);
          
          const { data: newPage, error: createError } = await supabase
            .from('pages')
            .insert({ url })
            .select()
            .single();
            
          if (createError) {
            console.error(`Debug: Error creating page: ${createError.message}`);
            throw new Error(`Error creating page: ${createError.message}`);
          }
          
          page = newPage;
          console.log(`Debug: Created new page with ID ${page.id}`);
        }
      }
    } catch (pageError) {
      console.error(`Debug: Error in page setup: ${pageError.message}`);
      throw new Error(`Page setup failed: ${pageError.message}`);
    }
    
    // Check if we have a valid page object
    if (!page || !page.id) {
      console.error(`Debug: Failed to get a valid page object`);
      throw new Error('Could not get or create a valid page');
    }
    
    console.log(`Debug: Working with page ID: ${page.id}, URL: ${page.url}`);
    
    // Check if we have HTML to analyze - if not, crawl with enhanced function
    if (!page.html || page.html.length === 0) {
      console.log(`Debug: No HTML content available for page ${page.id} (${page.url}) - starting enhanced crawl`);
      
      try {
        // Use enhanced crawl function for canonical URL and redirect handling
        const crawlResponse = await fetch(`${SUPABASE_URL}/functions/v1/crawl-page-html-enhanced`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SUPABASE_KEY}`
          },
          body: JSON.stringify({ url: page.url })
        });
        
        const crawlResult = await crawlResponse.json();
        
        if (crawlResult.success && crawlResult.httpStatus === 200) {
          console.log(`Debug: Enhanced crawl successful for ${page.url}`);
          console.log(`Debug: Original: ${crawlResult.originalUrl}`);
          console.log(`Debug: Final: ${crawlResult.finalUrl}`); 
          console.log(`Debug: Canonical: ${crawlResult.canonicalUrl}`);
          console.log(`Debug: HTTP Status: ${crawlResult.httpStatus}`);
          console.log(`Debug: Content Length: ${crawlResult.contentLength?.toLocaleString()}`);
          
          if (crawlResult.redirectChain?.length > 0) {
            console.log(`Debug: Redirects: ${crawlResult.redirectChain.join(', ')}`);
          }
          
          if (crawlResult.crossDomainCanonical) {
            console.log(`Debug: Cross-domain canonical detected: ${crawlResult.crossDomainCanonical} (noted but not followed)`);
          }
          
          // Refresh page data since enhanced crawl updated it
          const { data: updatedPage, error: refreshError } = await supabase
            .from('pages')
            .select('*')
            .eq('id', page.id)
            .single();
            
          if (!refreshError && updatedPage) {
            page = updatedPage;
            console.log(`Debug: Updated page data after enhanced crawl, HTML length: ${page.html_length}`);
          }
          
        } else if (crawlResult.httpStatus && crawlResult.httpStatus !== 200) {
          console.error(`Debug: Enhanced crawl returned non-200 status: ${crawlResult.httpStatus}`);
          throw new Error(`Cannot process page with HTTP status ${crawlResult.httpStatus}. Only 200 status pages are eligible for SEO processing.`);
        } else {
          console.error(`Debug: Enhanced crawl failed: ${crawlResult.error}`);
          throw new Error(`Enhanced crawl failed: ${crawlResult.error}`);
        }
        
      } catch (crawlError) {
        console.error(`Debug: Error during enhanced crawl: ${crawlError.message}`);
        throw new Error(`Failed to crawl page with enhanced canonical support: ${crawlError.message}`);
      }
    }
    
    // Final check - we should have HTML now
    if (!page.html || page.html.length === 0) {
      throw new Error(`Still no HTML content after enhanced crawl attempt for page ${page.id} (${page.url})`);
    }
    
    console.log(`Debug: Page has HTML content, length=${page.html.length}`);
    
    // Variables to store results
    let gscSuccessful = false;
    let seoAnalysisId = null;
    let seoSuccess = false;
    let errorMessage = null;
    
    // Step 3: First ensure we have keywords by either getting GSC data or extracting from content
    console.log(`Debug: Ensuring keywords are available for ${page.url}`);

    // Helper function to extract keywords from content
    async function extractKeywords() {
      console.log(`Debug: Extracting keywords from content for ${page.url}`);
      
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
        
        let responseText = '';
        try {
          responseText = await keywordResponse.text();
          console.log(`Debug: Keyword extraction response status: ${keywordResponse.status}`);
          console.log(`Debug: Keyword extraction response preview: ${responseText.substring(0, 200)}...`);
        } catch (textError) {
          console.error(`Debug: Error getting response text: ${textError.message}`);
        }
        
        if (keywordResponse.ok) {
          try {
            const keywordResult = JSON.parse(responseText);
            if (keywordResult.success) {
              console.log(`Debug: Successfully extracted ${keywordResult.gscCompatibleKeywords?.length || 0} keywords from content`);
              return true;
            } else {
              console.error(`Debug: Keyword extraction reported failure: ${keywordResult.error || 'Unknown error'}`);
            }
          } catch (parseError) {
            console.error(`Debug: Error parsing keyword extraction response: ${parseError.message}`);
          }
        } else {
          console.error(`Debug: Error extracting keywords: ${keywordResponse.status}`);
        }
      } catch (keywordError) {
        console.error(`Debug: Error calling extract-content-keywords: ${keywordError.message}`);
      }
      
      return false;
    }
    
    // Helper function to check if keywords exist in the recommendations
    async function checkForExistingKeywords() {
      try {
        // Check if there's already keywords in the page_seo_recommendations table
        const { data: recData, error: recError } = await supabase
          .from('page_seo_recommendations')
          .select('keywords')
          .eq('page_id', page.id)
          .single();
          
        if (!recError && recData?.keywords && Array.isArray(recData.keywords) && recData.keywords.length > 0) {
          console.log(`Debug: Found ${recData.keywords.length} existing keywords in page_seo_recommendations for page ${page.id}`);
          return true;
        } else {
          console.log(`Debug: No existing keywords found in page_seo_recommendations for page ${page.id}`);
          if (recError) {
            console.error(`Debug: Error checking existing keywords: ${recError.message}`);
          }
        }
      } catch (error) {
        console.error(`Debug: Error checking for existing keywords in recommendations: ${error.message}`);
      }
      
      return false;
    }
    
    // Helper function to check if GSC keywords already exist in the database
    async function checkForExistingGSCKeywords() {
      try {
        // Check if there are already GSC keywords stored
        const { count: gscCount, error: gscError } = await supabase
          .from('gsc_keywords')
          .select('*', { count: 'exact', head: true })
          .eq('page_id', page.id);
          
        if (gscError) {
          console.error(`Debug: Error checking gsc_keywords: ${gscError.message}`);
          return false;
        }
          
        const keywordCount = gscCount || 0;
        
        if (keywordCount > 0) {
          console.log(`Debug: Found ${keywordCount} existing GSC keywords for page ${page.id}`);
          
          // Copy these to the recommendations table
          const { data: gscKeywords, error: fetchError } = await supabase
            .from('gsc_keywords')
            .select('keyword, clicks, impressions, position, ctr')
            .eq('page_id', page.id)
            .order('impressions', { ascending: false })
            .limit(20);
            
          if (fetchError) {
            console.error(`Debug: Error fetching GSC keywords: ${fetchError.message}`);
            return false;
          }
            
          if (!fetchError && gscKeywords && gscKeywords.length > 0) {
            console.log(`Debug: Copying ${gscKeywords.length} existing GSC keywords to recommendations`);
            
            // Copy to page_seo_recommendations
            const { data: existingRec, error: checkError } = await supabase
              .from('page_seo_recommendations')
              .select('id')
              .eq('page_id', page.id)
              .limit(1);
              
            if (checkError) {
              console.error(`Debug: Error checking existing recommendations: ${checkError.message}`);
              return false;
            }
              
            if (!checkError) {
              if (existingRec && existingRec.length > 0) {
                // Update existing record
                const { error: updateError } = await supabase
                  .from('page_seo_recommendations')
                  .update({
                    keywords: gscKeywords,
                    updated_at: new Date().toISOString()
                  })
                  .eq('id', existingRec[0].id);
                  
                if (updateError) {
                  console.error(`Debug: Error updating keywords in recommendations: ${updateError.message}`);
                  return false;
                }
              } else {
                // Insert new record
                const { error: insertError } = await supabase
                  .from('page_seo_recommendations')
                  .insert({
                    page_id: page.id,
                    url: page.url,
                    keywords: gscKeywords,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                  });
                  
                if (insertError) {
                  console.error(`Debug: Error inserting keywords to recommendations: ${insertError.message}`);
                  return false;
                }
              }
              
              console.log('Debug: Successfully copied existing GSC keywords to recommendations');
              return true;
            }
          }
        } else {
          console.log(`Debug: No existing GSC keywords found for page ${page.id}`);
        }
      } catch (error) {
        console.error(`Debug: Error checking for existing GSC keywords: ${error.message}`);
      }
      
      return false;
    }
    
    try {
      // First check for existing keywords from previous runs
      let hasKeywords = await checkForExistingKeywords();
      
      // If no keywords in recommendations, check if we have GSC keywords already stored
      if (!hasKeywords) {
        hasKeywords = await checkForExistingGSCKeywords();
      }
      
      // If we still don't have keywords, try fetching new GSC data
      if (!hasKeywords) {
        try {
          console.log(`Debug: Fetching GSC data for ${page.url}`);
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
          
          let gscResponseText = '';
          try {
            gscResponseText = await gscResponse.text();
            console.log(`Debug: GSC data response status: ${gscResponse.status}`);
            console.log(`Debug: GSC data response preview: ${gscResponseText.substring(0, 200)}...`);
          } catch (textError) {
            console.error(`Debug: Error getting GSC response text: ${textError.message}`);
          }
          
          if (gscResponse.ok) {
            gscSuccessful = true;
            console.log(`Debug: Successfully fetched GSC data for ${page.url}`);
            
            // Check if we actually got any GSC keywords
            const { count: keywordCount, error: keywordsError } = await supabase
              .from('gsc_keywords')
              .select('*', { count: 'exact', head: true })
              .eq('page_id', page.id);

            if (keywordsError) {
              console.error(`Debug: Error checking keyword count: ${keywordsError.message}`);
            }
              
            // keywordCount is already defined above from the query
            console.log(`Debug: Found ${keywordCount || 0} GSC keywords for page ${page.id}`);
            
            if (keywordCount > 0) {
              // Copy GSC keywords to page_seo_recommendations
              const { data: gscKeywords, error: gscError } = await supabase
                .from('gsc_keywords')
                .select('keyword, clicks, impressions, position, ctr')
                .eq('page_id', page.id)
                .order('impressions', { ascending: false })
                .limit(20);

              if (gscError) {
                console.error(`Debug: Error fetching GSC keywords for copying: ${gscError.message}`);
              }
                
              if (!gscError && gscKeywords && gscKeywords.length > 0) {
                console.log(`Debug: Copying ${gscKeywords.length} GSC keywords to recommendations table`);
                
                // Check if an entry exists
                const { data: existingRec, error: checkError } = await supabase
                  .from('page_seo_recommendations')
                  .select('id')
                  .eq('page_id', page.id)
                  .limit(1);

                if (checkError) {
                  console.error(`Debug: Error checking existing record: ${checkError.message}`);
                }
                  
                if (!checkError) {
                  if (existingRec && existingRec.length > 0) {
                    // Update existing record
                    const { error: updateError } = await supabase
                      .from('page_seo_recommendations')
                      .update({
                        keywords: gscKeywords,
                        updated_at: new Date().toISOString()
                      })
                      .eq('id', existingRec[0].id);

                    if (updateError) {
                      console.error(`Debug: Error updating keywords: ${updateError.message}`);
                    }
                  } else {
                    // Insert new record
                    const { error: insertError } = await supabase
                      .from('page_seo_recommendations')
                      .insert({
                        page_id: page.id,
                        url: page.url,
                        keywords: gscKeywords,
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                      });

                    if (insertError) {
                      console.error(`Debug: Error inserting record: ${insertError.message}`);
                    }
                  }
                  
                  console.log('Debug: Successfully stored GSC keywords in recommendations table');
                  hasKeywords = true;
                }
              }
            }
            
            // If no GSC keywords were stored, try content extraction
            if (!hasKeywords) {
              console.log(`Debug: No usable GSC keywords, trying AI extraction for ${page.url}`);
              hasKeywords = await extractKeywords();
            }
          } else {
            console.error(`Debug: Error fetching GSC data: ${gscResponse.status} ${gscResponseText}`);
            // GSC failed, try AI extraction
            hasKeywords = await extractKeywords();
          }
        } catch (error) {
          console.error(`Debug: Error in GSC workflow: ${error.message}`);
          // Try AI extraction as fallback
          hasKeywords = await extractKeywords();
        }
      }
      
      // Log keyword availability status
      if (hasKeywords) {
        console.log(`Debug: ✅ Keywords are available for ${page.url}`);
        gscSuccessful = true;
      } else {
        console.log(`Debug: ⚠️ Could not get keywords for ${page.url}`);
      }
    } catch (keywordError) {
      console.error(`Debug: Error in keyword handling: ${keywordError.message}`);
      throw new Error(`Keyword handling failed: ${keywordError.message}`);
    }
    
    // Step 4: Run on-page SEO analysis
    console.log(`Debug: Running on-page SEO analysis for ${page.url}`);
    
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
      
      let seoResponseText = '';
      try {
        seoResponseText = await seoResponse.text();
        console.log(`Debug: SEO analysis response status: ${seoResponse.status}`);
        console.log(`Debug: SEO analysis response preview: ${seoResponseText.substring(0, 200)}...`);
      } catch (textError) {
        console.error(`Debug: Error getting SEO response text: ${textError.message}`);
      }
      
      if (!seoResponse.ok) {
        errorMessage = `SEO analysis failed: ${seoResponse.status} ${seoResponse.statusText} - ${seoResponseText}`;
        console.error(`Debug: ${errorMessage}`);
      } else {
        console.log(`Debug: Successfully analyzed SEO for ${page.url}`);
        
        try {
          const seoResult = JSON.parse(seoResponseText);
          
          if (seoResult.success && seoResult.analysis && seoResult.analysis.id) {
            seoAnalysisId = seoResult.analysis.id;
            seoSuccess = true;
          } else {
            console.error(`Debug: SEO analysis returned success=false or missing data: ${JSON.stringify(seoResult)}`);
          }
        } catch (parseError) {
          console.error(`Debug: Error parsing SEO analysis response: ${parseError.message}`);
          errorMessage = `Error parsing SEO analysis response: ${parseError.message}`;
        }
      }
    } catch (error) {
      errorMessage = `SEO analysis exception: ${error.message}`;
      console.error(`Debug: ${errorMessage}`);
    }
    
    // Helper function to retry edge function calls
    async function callEdgeFunctionWithRetry(
      url: string,
      body: any,
      headers: any,
      maxRetries: number = 3,
      initialDelay: number = 1000
    ): Promise<Response | null> {
      let lastError: Error | null = null;
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          console.log(`Debug: Attempt ${attempt}/${maxRetries} calling ${url}`);
          
          const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body)
          });
          
          // Check for boot errors specifically
          if (response.status === 503) {
            const responseText = await response.text();
            if (responseText.includes('BOOT_ERROR')) {
              console.error(`Debug: Edge function boot error on attempt ${attempt}: ${responseText}`);
              
              // For boot errors, wait longer between retries
              if (attempt < maxRetries) {
                const delay = initialDelay * Math.pow(2, attempt - 1) * 2; // Double the delay for boot errors
                console.log(`Debug: Waiting ${delay}ms before retry due to boot error...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
              }
            }
          }
          
          // If we get here, return the response (whether successful or not)
          return response;
          
        } catch (error) {
          lastError = error as Error;
          console.error(`Debug: Network error on attempt ${attempt}: ${lastError.message}`);
          
          if (attempt < maxRetries) {
            const delay = initialDelay * Math.pow(2, attempt - 1);
            console.log(`Debug: Waiting ${delay}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }
      
      console.error(`Debug: All ${maxRetries} attempts failed. Last error: ${lastError?.message}`);
      return null;
    }

    // Step 5: Generate SEO elements using GPT-OSS-120B (title, h1, h2, paragraph)
    console.log(`Debug: Generating SEO elements using GPT-OSS-120B for ${page.url}`);
    
    try {
      // First try calling the generate-seo-elements function
      let success = false;
      let elementsResponse = null;
      
      try {
        // Call generate-seo-elements-gptoss function (Groq GPT-OSS-120B) with retry logic
        elementsResponse = await callEdgeFunctionWithRetry(
          `${SUPABASE_URL}/functions/v1/generate-seo-elements-gptoss`,
          {
            pageId: page.id,
            url: page.url
          },
          {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SUPABASE_KEY}`
          },
          3, // max retries
          2000 // initial delay of 2 seconds
        );
        
        if (elementsResponse) {
          let elementsResponseText = '';
          try {
            elementsResponseText = await elementsResponse.text();
            console.log(`Debug: SEO elements response status: ${elementsResponse.status}`);
            console.log(`Debug: SEO elements response preview: ${elementsResponseText.substring(0, 200)}...`);
          } catch (textError) {
            console.error(`Debug: Error getting elements response text: ${textError.message}`);
          }
          
          if (elementsResponse.ok) {
          console.log(`Debug: Successfully generated SEO elements using GPT-OSS-120B for ${page.url}`);
          
          try {
            const elementsResult = JSON.parse(elementsResponseText);
            
            if (elementsResult.success && elementsResult.seoElements) {
              console.log(`Debug: GPT-OSS generated SEO elements: Title=${elementsResult.seoElements.title?.substring(0, 30)}..., H1=${elementsResult.seoElements.h1?.substring(0, 30)}...`);
              success = true;
              seoSuccess = true;
            } else {
              console.error(`Debug: SEO elements returned success=false or missing data: ${JSON.stringify(elementsResult)}`);
            }
          } catch (parseError) {
            console.error(`Debug: Error parsing SEO elements response: ${parseError.message}`);
          }
          } else {
            // Log the specific error
            if (elementsResponse.status === 503) {
              console.error(`Debug: SEO service temporarily unavailable (503). Response: ${elementsResponseText}`);
              errorMessage = 'SEO service temporarily unavailable - will use placeholder content';
            } else {
              console.error(`Debug: SEO elements generation failed: ${elementsResponse.status} ${elementsResponse.statusText} - ${elementsResponseText}`);
              errorMessage = `SEO generation failed with status ${elementsResponse.status}`;
            }
          }
        } else {
          console.error(`Debug: Failed to connect to SEO elements service after all retries`);
          errorMessage = 'Could not connect to SEO generation service';
        }
      } catch (apiError) {
        console.error(`Debug: API call exception for SEO elements: ${apiError.message}`);
        errorMessage = `SEO generation error: ${apiError.message}`;
      }
      
      // Always ensure we have SEO content, even if it's placeholder
      if (!success) {
        console.log(`Debug: Using fallback placeholder SEO content for ${page.url}`);
        
        // Extract domain and path for better title/description
        const urlObj = new URL(page.url);
        const domain = urlObj.hostname.replace('www.', '');
        const path = urlObj.pathname.split('/').filter(p => p).join(' ');
        
        // Check if record exists first
        const { data: existingRec, error: checkError } = await supabase
          .from('page_seo_recommendations')
          .select('id')
          .eq('page_id', page.id)
          .single();
        
        const seoData = {
          page_id: page.id,
          url: page.url,
          title: `${path ? path.replace(/-/g, ' ') : 'Products'} | ${domain}`,
          meta_description: `Explore ${path ? path.replace(/-/g, ' ') : 'our products'} at ${domain}. Find great deals on ${urlObj.pathname.split('/').pop()?.replace(/-/g, ' ') || 'items'}.`,
          h1: `${path ? path.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : 'Products'}`,
          h2: `Explore Our ${urlObj.pathname.split('/').pop()?.replace(/-/g, ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || 'Collection'}`,
          paragraph: `Browse our selection of ${path ? path.replace(/-/g, ' ') : 'products'} designed to meet your needs. We offer quality items at competitive prices, with options for every preference and budget.`,
          updated_at: new Date().toISOString()
        };
        
        if (!checkError && existingRec) {
          // Update existing record
          console.log(`Debug: Updating existing SEO record for page ${page.id}`);
          const { error: updateError } = await supabase
            .from('page_seo_recommendations')
            .update(seoData)
            .eq('page_id', page.id);
            
          if (updateError) {
            console.error(`Debug: Error updating SEO elements: ${updateError.message}`);
          } else {
            console.log(`Debug: Successfully updated placeholder SEO elements for ${page.url}`);
          }
        } else {
          // Insert new record
          console.log(`Debug: Inserting new SEO record for page ${page.id}`);
          const { error: insertError } = await supabase
            .from('page_seo_recommendations')
            .insert(seoData);
            
          if (insertError) {
            console.error(`Debug: Error inserting SEO elements: ${insertError.message}`);
          } else {
            console.log(`Debug: Successfully inserted placeholder SEO elements for ${page.url}`);
          }
        }
      }
    } catch (error) {
      console.error(`Debug: SEO elements generation exception: ${error.message}`);
    }
    
    // Step 5: Update tracking record if we have one
    if (trackingId) {
      console.log(`Debug: Updating tracking record ${trackingId} with success=${seoSuccess}`);
      
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
        console.error(`Debug: Error updating tracking record: ${updateError.message}`);
      } else {
        console.log(`Debug: Successfully updated tracking record`);
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
        tracking_id: trackingId
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    console.error(`Debug: Final error: ${error.message}`);
    
    // Update tracking record with error
    if (trackingId) {
      try {
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
      } catch (trackingError) {
        console.error(`Debug: Error updating tracking record with error: ${trackingError.message}`);
      }
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