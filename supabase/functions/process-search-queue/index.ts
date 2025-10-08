// supabase/functions/process-search-queue/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { setupHeartbeat } from '../utils/heartbeat.ts';

serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  let job_id;
  
  try {
    const requestData = await req.json();
    job_id = requestData.job_id;
    
    if (!job_id) {
      return new Response(
        JSON.stringify({ error: 'job_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    console.log(`Process search queue started for job_id: ${job_id}`);
    
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Validate that the job exists
    const { data: job, error: jobError } = await supabase
      .from('outline_generation_jobs')
      .select('id, status')
      .eq('id', job_id)
      .single();

    if (jobError || !job) {
      return new Response(
        JSON.stringify({ error: `Job not found: ${jobError?.message || 'Unknown error'}` }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Start the processing in the background
    (async () => {
      try {
        // Small delay to ensure the response is sent
        await new Promise(resolve => setTimeout(resolve, 200));
        
        console.log(`Beginning background queue processing for job_id: ${job_id}`);
        
        // Setup heartbeat for the job (every 30 seconds)
        const stopHeartbeat = setupHeartbeat(job_id, 30000);
        
        // Process a batch of pending search terms
        const BATCH_SIZE = 5; // Process 5 terms at a time to avoid timeouts
        
        // Get the next batch of pending search terms
        const { data: pendingTerms, error: pendingError } = await supabase
          .from('outline_search_queue')
          .select('*')
          .eq('job_id', job_id)
          .eq('status', 'pending')
          .order('priority', { ascending: true })
          .order('id', { ascending: true })
          .limit(BATCH_SIZE);
          
        if (pendingError) {
          throw new Error(`Error fetching pending search terms: ${pendingError.message}`);
        }
        
        // If no pending terms, check if we're done
        if (!pendingTerms || pendingTerms.length === 0) {
          console.log(`No pending search terms found for job_id: ${job_id}, checking if search is complete`);
          
          // Check if all search terms are processed
          const { count: pendingCount, error: countError } = await supabase
            .from('outline_search_queue')
            .select('*', { count: 'exact', head: true })
            .eq('job_id', job_id)
            .eq('status', 'pending');
            
          if (countError) {
            throw new Error(`Error counting pending search terms: ${countError.message}`);
          }
          
          if (pendingCount === 0) {
            console.log(`All search terms processed for job_id: ${job_id}, triggering analysis`);
            
            // Update job status to search completed
            await supabase
              .from('outline_generation_jobs')
              .update({ 
                status: 'search_completed',
                updated_at: new Date().toISOString()
              })
              .eq('id', job_id);
              
            // Add search completion status
            await supabase
              .from('content_plan_outline_statuses')
              .insert({
                outline_guid: job_id,
                status: 'search_phase_completed'
              });
            
            // Calculate the total results
            const { data: resultsData, error: resultsError } = await supabase
              .from('outline_search_results')
              .select('*', { count: 'exact', head: true })
              .eq('job_id', job_id);
              
            const totalResults = resultsError ? 0 : (resultsData?.length || 0);
            
            // Add results count to status
            await supabase
              .from('content_plan_outline_statuses')
              .insert({
                outline_guid: job_id,
                status: `collected_${totalResults}_search_results`
              });
              
            // Trigger the analyze-outline-content function
            try {
              console.log(`Triggering analysis for job_id: ${job_id}`);
              const analysisResponse = await fetch(`${supabaseUrl}/functions/v1/analyze-outline-content`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${supabaseServiceKey}`
                },
                body: JSON.stringify({ job_id })
              });
              
              if (!analysisResponse.ok) {
                const errorText = await analysisResponse.text();
                console.error(`Failed to start analysis. Status: ${analysisResponse.status}, Error: ${errorText}`);
                
                throw new Error(`Failed to start analysis: ${errorText}`);
              }
              
              console.log(`Successfully triggered analysis for job_id: ${job_id}`);
              
              // Stop the heartbeat as we're done with this phase
              stopHeartbeat();
            } catch (analysisError) {
              // Stop heartbeat even on error
              stopHeartbeat();
              throw new Error(`Error triggering analysis: ${analysisError.message}`);
            }
            
            return;
          }
          
          // If we still have pending but none were returned, there might be an issue
          // Let's wait and try again
          console.log(`Still have ${pendingCount} pending terms but none were returned, waiting before retry`);
          await new Promise(resolve => setTimeout(resolve, 5000));
          
          // Retry by recursively calling this function
          await fetch(`${supabaseUrl}/functions/v1/process-search-queue`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${supabaseServiceKey}`
            },
            body: JSON.stringify({ job_id })
          });
          
          return;
        }
        
        console.log(`Processing ${pendingTerms.length} search terms for job_id: ${job_id}`);
        
        // Update status for UI
        await supabase
          .from('content_plan_outline_statuses')
          .insert({
            outline_guid: job_id,
            status: `processing_search_batch: ${pendingTerms.length} terms`
          });
        
        // Process each term in the batch
        for (const term of pendingTerms) {
          console.log(`Processing search term: ${term.search_term} (ID: ${term.id})`);
          
          // First update the status to in-progress and increment attempts
          await supabase
            .from('outline_search_queue')
            .update({ 
              status: 'processing',
              attempts: term.attempts + 1
            })
            .eq('id', term.id);
          
          try {
            // Run the search with Jina API
            const encodedTerm = encodeURIComponent(term.search_term);
            const searchUrl = `https://s.jina.ai/?q=${encodedTerm}&num=10`;
            
            console.log(`Searching for term: ${term.search_term}`);
            
            // Create an AbortController for timeout
            const controller = new AbortController();
            const SEARCH_TIMEOUT_MS = 360000; // 360 seconds (6 minutes) timeout
            const timeoutId = setTimeout(() => {
              controller.abort();
              console.log(`Search timeout for term: ${term.search_term}`);
            }, SEARCH_TIMEOUT_MS);
            
            try {
              const searchResponse = await fetch(searchUrl, {
                signal: controller.signal,
                headers: {
                  'Accept': 'application/json',
                  'Authorization': 'Bearer jina_335b0361bef84b3694f1f8f23184b552j_S3s2fdN5mu5w3DXzq54O9DtCBe',
                  'X-Engine': 'browser'
                }
              });
              
              // Clear the timeout since we got a response
              clearTimeout(timeoutId);
              
              if (searchResponse.ok) {
                const searchData = await searchResponse.json();
                let resultsCount = 0;
                
                // Process the Jina.ai API response format
                if (searchData.code === 200 && searchData.status === 20000 && searchData.data && Array.isArray(searchData.data)) {
                  console.log(`Received ${searchData.data.length} results for term: ${term.search_term}`);
                  
                  // Save search results
                  for (const result of searchData.data) {
                    // Skip results without a URL
                    if (!result.url) continue;
                    
                    // Save result to database
                    await supabase
                      .from('outline_search_results')
                      .insert({
                        job_id,
                        search_term: term.search_term,
                        search_category: term.category,
                        search_priority: term.priority,
                        url: result.url,
                        title: result.title || '',
                        description: result.description || '',
                        publishedTime: result.publishedTime || null,
                        date: result.date || null,
                        content: result.content || ''
                      });
                      
                    resultsCount++;
                  }
                } else if (searchData.results && Array.isArray(searchData.results) && searchData.results.length > 0) {
                  // Try fallback format
                  console.log(`Using fallback results format with ${searchData.results.length} items`);
                  
                  for (const result of searchData.results) {
                    if (!result.url) continue;
                    
                    // Save result to database
                    await supabase
                      .from('outline_search_results')
                      .insert({
                        job_id,
                        search_term: term.search_term,
                        search_category: term.category,
                        search_priority: term.priority,
                        url: result.url,
                        title: result.title || '',
                        description: result.snippet || '',
                        publishedTime: result.publishedTime || null,
                        date: result.date || null,
                        content: result.content || ''
                      });
                      
                    resultsCount++;
                  }
                }
                
                // Mark this term as completed
                await supabase
                  .from('outline_search_queue')
                  .update({ 
                    status: 'completed',
                    processed_at: new Date().toISOString(),
                    result_count: resultsCount
                  })
                  .eq('id', term.id);
                  
                console.log(`Term ${term.search_term} completed with ${resultsCount} results`);
              } else {
                const errorText = await searchResponse.text();
                console.error(`Error searching for "${term.search_term}": Status ${searchResponse.status}`);
                console.error(`Response body: ${errorText}`);
                
                // If this is a rate limiting error, wait and keep as pending
                if (searchResponse.status === 429) {
                  await supabase
                    .from('outline_search_queue')
                    .update({ 
                      status: 'pending', // Keep as pending for retry
                      attempts: term.attempts + 1
                    })
                    .eq('id', term.id);
                    
                  // Wait a bit before continuing
                  await new Promise(resolve => setTimeout(resolve, 2000));
                } else {
                  // For other errors, mark as failed
                  await supabase
                    .from('outline_search_queue')
                    .update({ 
                      status: 'failed',
                      processed_at: new Date().toISOString()
                    })
                    .eq('id', term.id);
                }
              }
            } catch (searchError) {
              // Clear the timeout in case of error
              clearTimeout(timeoutId);
              
              console.error(`Error searching for "${term.search_term}": ${searchError.message}`);
              
              // Handle abort errors specially (timeouts)
              if (searchError.name === 'AbortError') {
                console.log(`Search timeout for "${term.search_term}"`);
                
                // For timeouts, keep the term as pending for retry if under max attempts
                const MAX_SEARCH_ATTEMPTS = 3;
                if (term.attempts < MAX_SEARCH_ATTEMPTS) {
                  await supabase
                    .from('outline_search_queue')
                    .update({ 
                      status: 'pending', // Keep as pending to retry
                      attempts: term.attempts + 1
                    })
                    .eq('id', term.id);
                    
                  await supabase
                    .from('content_plan_outline_statuses')
                    .insert({
                      outline_guid: job_id,
                      status: `Search timeout for "${term.search_term}" - will retry (attempt ${term.attempts + 1}/${MAX_SEARCH_ATTEMPTS})`
                    });
                    
                  console.log(`Marked "${term.search_term}" for retry (attempt ${term.attempts + 1}/${MAX_SEARCH_ATTEMPTS})`);
                } else {
                  // If max attempts reached, mark as failed
                  await supabase
                    .from('outline_search_queue')
                    .update({ 
                      status: 'failed',
                      processed_at: new Date().toISOString()
                    })
                    .eq('id', term.id);
                    
                  await supabase
                    .from('content_plan_outline_statuses')
                    .insert({
                      outline_guid: job_id,
                      status: `Search term "${term.search_term}" failed after ${MAX_SEARCH_ATTEMPTS} attempts`
                    });
                    
                  console.log(`Marked "${term.search_term}" as failed after ${MAX_SEARCH_ATTEMPTS} attempts`);
                }
              } else {
                // For other errors, mark as failed
                await supabase
                  .from('outline_search_queue')
                  .update({ 
                    status: 'failed',
                    processed_at: new Date().toISOString()
                  })
                  .eq('id', term.id);
                  
                await supabase
                  .from('content_plan_outline_statuses')
                  .insert({
                    outline_guid: job_id,
                    status: `Search error for "${term.search_term}": ${searchError.message.substring(0, 100)}`
                  });
              }
            }
          } catch (termError) {
            console.error(`General error processing term "${term.search_term}": ${termError.message}`);
            
            // For any other errors, mark as failed
            await supabase
              .from('outline_search_queue')
              .update({ 
                status: 'failed',
                processed_at: new Date().toISOString()
              })
              .eq('id', term.id);
          }
        }
        
        // Check if more pending terms exist
        const { count: remainingCount, error: remainingError } = await supabase
          .from('outline_search_queue')
          .select('*', { count: 'exact', head: true })
          .eq('job_id', job_id)
          .eq('status', 'pending');
          
        if (remainingError) {
          console.error(`Error counting remaining terms: ${remainingError.message}`);
        } else {
          console.log(`${remainingCount} pending terms remaining for job_id: ${job_id}`);
          
          // Update status for UI
          await supabase
            .from('content_plan_outline_statuses')
            .insert({
              outline_guid: job_id,
              status: `pending_searches: ${remainingCount} remaining`
            });
            
          // If more terms exist, trigger another run
          if (remainingCount > 0) {
            console.log(`Triggering next batch for job_id: ${job_id}`);
            try {
              // Wait a moment to avoid overloading
              await new Promise(resolve => setTimeout(resolve, 1000));
              
              // Call this function again to process next batch
              await fetch(`${supabaseUrl}/functions/v1/process-search-queue`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${supabaseServiceKey}`
                },
                body: JSON.stringify({ job_id })
              });
              
              console.log(`Next batch triggered for job_id: ${job_id}`);
            } catch (nextBatchError) {
              console.error(`Error triggering next batch: ${nextBatchError.message}`);
            }
          } else {
            // If all terms are processed, trigger analysis
            console.log(`All search terms processed for job_id: ${job_id}, triggering analysis`);
            
            // Update job status to search completed
            await supabase
              .from('outline_generation_jobs')
              .update({ 
                status: 'search_completed',
                updated_at: new Date().toISOString()
              })
              .eq('id', job_id);
              
            // Add search completion status
            await supabase
              .from('content_plan_outline_statuses')
              .insert({
                outline_guid: job_id,
                status: 'search_phase_completed'
              });
            
            // Calculate the total results
            const { data: resultsData, error: resultsError } = await supabase
              .from('outline_search_results')
              .select('*', { count: 'exact', head: true })
              .eq('job_id', job_id);
              
            const totalResults = resultsError ? 0 : (resultsData?.length || 0);
            
            // Add results count to status
            await supabase
              .from('content_plan_outline_statuses')
              .insert({
                outline_guid: job_id,
                status: `collected_${totalResults}_search_results`
              });
              
            // Trigger the analyze-outline-content function
            try {
              console.log(`Triggering analysis for job_id: ${job_id}`);
              const analysisResponse = await fetch(`${supabaseUrl}/functions/v1/analyze-outline-content`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${supabaseServiceKey}`
                },
                body: JSON.stringify({ job_id })
              });
              
              if (!analysisResponse.ok) {
                const errorText = await analysisResponse.text();
                console.error(`Failed to start analysis. Status: ${analysisResponse.status}, Error: ${errorText}`);
                
                throw new Error(`Failed to start analysis: ${errorText}`);
              }
              
              console.log(`Successfully triggered analysis for job_id: ${job_id}`);
              
              // Stop the heartbeat as we're done with this phase
              stopHeartbeat();
            } catch (analysisError) {
              // Stop heartbeat even on error
              stopHeartbeat();
              throw new Error(`Error triggering analysis: ${analysisError.message}`);
            }
          }
        }
      } catch (backgroundError) {
        console.error('Error in background queue processing:', backgroundError);
        
        // Stop the heartbeat
        stopHeartbeat();
        
        // Update job status on error
        try {
          await supabase
            .from('outline_generation_jobs')
            .update({ 
              status: 'search_queue_error',
              updated_at: new Date().toISOString(),
              heartbeat_at: null // Clear heartbeat when job is done
            })
            .eq('id', job_id);
            
          await supabase
            .from('content_plan_outline_statuses')
            .insert({
              outline_guid: job_id,
              status: `search_queue_error: ${backgroundError.message.substring(0, 100)}`
            });
        } catch (updateError) {
          console.error('Error updating job status:', updateError);
        }
      }
    })();
    
    // Return immediate response
    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Search queue processing started', 
        job_id
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error processing search queue request:', error);
    
    // Update job status on error
    if (job_id) {
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
        const supabase = createClient(supabaseUrl, supabaseServiceKey);
        
        await supabase
          .from('outline_generation_jobs')
          .update({ 
            status: 'search_queue_error',
            updated_at: new Date().toISOString()
          })
          .eq('id', job_id);
      } catch (updateError) {
        console.error('Error updating job status:', updateError);
      }
    }
    
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});