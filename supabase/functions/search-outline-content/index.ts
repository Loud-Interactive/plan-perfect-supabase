// supabase/functions/search-outline-content/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk';

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
    
    console.log(`Search outline content started for job_id: ${job_id}`);
    
    // Initialize Supabase client for validation
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const validationClient = createClient(supabaseUrl, supabaseServiceKey);

    // Validate that the job exists before returning response
    const { data: job, error: jobError } = await validationClient
      .from('outline_generation_jobs')
      .select('id')
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
        
        console.log(`Beginning background search processing for job_id: ${job_id}`);
        
        // Create a new Supabase client for the background process
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        // Initialize Anthropic client
        const anthropic = new Anthropic({
          apiKey: Deno.env.get('ANTHROPIC_API_KEY') || '',
        });

        // Step 1: Fetch job details
        const { data: jobDetails, error: jobDetailsError } = await supabase
          .from('outline_generation_jobs')
          .select('*')
          .eq('id', job_id)
          .single();

        if (jobDetailsError || !jobDetails) {
          throw new Error(`Job details not found: ${jobDetailsError?.message || 'Unknown error'}`);
        }

        // Step 2: Update job status
        await supabase
          .from('outline_generation_jobs')
          .update({ status: 'determining_search_terms', updated_at: new Date().toISOString() })
          .eq('id', job_id);
          
        // Add detailed status for the Next.js app
        await supabase
          .from('content_plan_outline_statuses')
          .insert({
            outline_guid: job_id,
            status: 'search_process_initialized'
          });
        
        // Insert status record for search terms
        await supabase
          .from('content_plan_outline_statuses')
          .insert({
            outline_guid: job_id,
            status: `determining_search_terms_for: ${jobDetails.post_keyword}`
          });
        
        // More specific status
        await supabase
          .from('content_plan_outline_statuses')
          .insert({
            outline_guid: job_id,
            status: 'getting_search_terms'
          });

        // Step 3: Fetch client profile for domain-specific guidance
        console.log(`Fetching client profile for domain: ${jobDetails.domain}`);
        let clientSynopsis = '';
        try {
          // Status update for profile fetch
          await supabase
            .from('content_plan_outline_statuses')
            .insert({
              outline_guid: job_id,
              status: `fetching_client_profile_for: ${jobDetails.domain}`
            });
            
          const clientProfileResponse = await fetch(`https://pp-api.replit.app/pairs/all/${jobDetails.domain}`);
          if (clientProfileResponse.ok) {
            const clientProfile = await clientProfileResponse.json();
            clientSynopsis = clientProfile.synopsis || '';
            console.log(`Retrieved client profile with synopsis of length: ${clientSynopsis.length}`);
            
            // Success status
            await supabase
              .from('content_plan_outline_statuses')
              .insert({
                outline_guid: job_id,
                status: 'client_profile_retrieved'
              });
          } else {
            console.log(`Error fetching client profile: ${clientProfileResponse.status}`);
            
            // Error status
            await supabase
              .from('content_plan_outline_statuses')
              .insert({
                outline_guid: job_id,
                status: `client_profile_fetch_failed: ${clientProfileResponse.status}`
              });
          }
        } catch (profileError) {
          console.error(`Error fetching client profile: ${profileError.message}`);
          
          // Error status
          await supabase
            .from('content_plan_outline_statuses')
            .insert({
              outline_guid: job_id,
              status: `client_profile_fetch_error: ${profileError.message.substring(0, 100)}`
            });
            
          // Continue even if this fails
        }

        // Step 4: Generate search terms with Claude AI
        console.log('Generating search terms with Claude AI');
        
        // Status update for AI search term generation
        await supabase
          .from('content_plan_outline_statuses')
          .insert({
            outline_guid: job_id,
            status: 'generating_search_terms_with_ai'
          });
          
        const searchTermsPrompt = `You are a world-class SEO content researcher. Your task is to generate optimal search terms for researching and writing a comprehensive article. 

I need you to analyze three key inputs and generate search terms that will yield the most valuable research material:

1. Content Plan Keyword: "${jobDetails.content_plan_keyword}" (the broader topic/category)
2. Post Keyword: "${jobDetails.post_keyword}" (the specific focus of this article)
3. Post Title: "${jobDetails.post_title}" (the angle and context)

Brand Context: This content is for ${jobDetails.domain}. ${clientSynopsis}

Based on these inputs, generate THREE DISTINCT SETS of search terms:

SET 1: 3 search terms that combine the content plan keyword with the post keyword
SET 2: 3 search terms based specifically on the post title's angle
SET 3: 3 search terms that explore related concepts, common questions, or typical pain points

Respond with a JSON structure containing these three sets of search terms. Format your response ONLY as valid JSON that can be parsed directly:

{
  "combinedTerms": ["term1", "term2", "term3"],
  "titleAngleTerms": ["term4", "term5", "term6"],
  "relatedConceptTerms": ["term7", "term8", "term9"]
}`;

        const searchTermsResponse = await anthropic.beta.messages.create({
          model: "claude-3-7-sonnet-20250219",
          max_tokens: 1000,
          temperature: 1,
          messages: [
            {
              role: "user",
              content: searchTermsPrompt
            }
          ]
        });

        // Parse search terms - handle different response structures
        let searchTermsText = '';
        if (Array.isArray(searchTermsResponse.content)) {
          searchTermsText = searchTermsResponse.content[0].text;
        } else if (typeof searchTermsResponse.content === 'string') {
          searchTermsText = searchTermsResponse.content;
        }
        
        // Clean the string and parse as JSON
        searchTermsText = searchTermsText.replace(/```json|```/g, '').trim();
        console.log(`Raw search terms response: ${searchTermsText}`);
        
        let searchTermsStructure;
        try {
          searchTermsStructure = JSON.parse(searchTermsText);
          console.log('Successfully parsed search terms JSON structure');
          
          // Success status
          await supabase
            .from('content_plan_outline_statuses')
            .insert({
              outline_guid: job_id,
              status: 'search_terms_generated_successfully'
            });
        } catch (parseError) {
          console.error(`Error parsing search terms JSON: ${parseError.message}`);
          // Create a default structure if parsing fails
          searchTermsStructure = {
            combinedTerms: [`${jobDetails.content_plan_keyword} ${jobDetails.post_keyword}`],
            titleAngleTerms: [jobDetails.post_title],
            relatedConceptTerms: [jobDetails.post_keyword]
          };
          console.log('Using fallback search terms structure');
          
          // Fallback status
          await supabase
            .from('content_plan_outline_statuses')
            .insert({
              outline_guid: job_id,
              status: 'using_fallback_search_terms'
            });
        }

        // Always include the main keywords directly
        const basePriorityTerms = [
          jobDetails.post_keyword,                      // Top priority - the specific focus
          jobDetails.content_plan_keyword,              // Second priority - the broader topic
          `${jobDetails.post_keyword} ${jobDetails.domain}`,   // Domain-specific focus
          jobDetails.post_title                         // The exact title as a search term
        ];
        
        // Combine all search terms with priority information
        const allSearchTerms = [
          // Base terms - highest priority
          ...basePriorityTerms.map(term => ({ term, category: 'base', priority: 1 })),
          
          // Combined terms - second priority
          ...(searchTermsStructure.combinedTerms || []).map(term => ({ term, category: 'combined', priority: 2 })),
          
          // Title angle terms - third priority
          ...(searchTermsStructure.titleAngleTerms || []).map(term => ({ term, category: 'titleAngle', priority: 3 })),
          
          // Related concept terms - fourth priority
          ...(searchTermsStructure.relatedConceptTerms || []).map(term => ({ term, category: 'relatedConcept', priority: 4 }))
        ];
        
        // Remove any duplicates
        const uniqueTerms = [];
        const termSet = new Set();
        
        for (const termObj of allSearchTerms) {
          const normalizedTerm = termObj.term.toLowerCase().trim();
          if (!termSet.has(normalizedTerm) && normalizedTerm.length > 0) {
            termSet.add(normalizedTerm);
            uniqueTerms.push(termObj);
          }
        }
        
        console.log(`Created ${uniqueTerms.length} unique search terms across different categories`);
        
        // Fallback check
        if (uniqueTerms.length === 0) {
          uniqueTerms.push({ 
            term: jobDetails.post_keyword, 
            category: 'fallback', 
            priority: 1 
          });
          console.log(`Using fallback search term: ${jobDetails.post_keyword}`);
        }

        // Step 5: Update job status and save search terms
        await supabase
          .from('outline_generation_jobs')
          .update({ 
            status: 'running_searches',
            updated_at: new Date().toISOString()
          })
          .eq('id', job_id);
          
        // Insert status record for the Next.js app
        await supabase
          .from('content_plan_outline_statuses')
          .insert({
            outline_guid: job_id,
            status: 'preparing_to_fetch_search_results'
          });

        // Save search terms with category and priority information
        console.log('Saving search terms to database');
        for (const { term, category, priority } of uniqueTerms) {
          await supabase
            .from('outline_search_terms')
            .insert({
              job_id,
              search_term: term,
              category,
              priority
            });
        }

        // Step 6: Queue search terms for progressive processing
        console.log('Queueing search terms for progressive processing');
        
        // Status update for search process
        await supabase
          .from('content_plan_outline_statuses')
          .insert({
            outline_guid: job_id,
            status: `queueing_${uniqueTerms.length}_search_terms`
          });
        
        // Add list of search terms to status for transparency
        const termsList = uniqueTerms.map(t => t.term).slice(0, 5).join(", ") + 
                         (uniqueTerms.length > 5 ? ` and ${uniqueTerms.length - 5} more` : "");
        await supabase
          .from('content_plan_outline_statuses')
          .insert({
            outline_guid: job_id,
            status: `search_terms: ${termsList}`
          });
        
        // First, insert all terms into the queue table
        console.log(`Queueing ${uniqueTerms.length} search terms for job_id: ${job_id}`);
        for (const { term, category, priority } of uniqueTerms) {
          await supabase
            .from('outline_search_queue')
            .insert({
              job_id,
              search_term: term,
              category,
              priority,
              status: 'pending'
            });
        }
        
        // Update job status to indicate search is queued
        await supabase
          .from('outline_generation_jobs')
          .update({ 
            status: 'search_queued',
            updated_at: new Date().toISOString()
          })
          .eq('id', job_id);
        
        // Add status update for UI
        await supabase
          .from('content_plan_outline_statuses')
          .insert({
            outline_guid: job_id,
            status: 'search_terms_queued'
          });
          
        console.log('Search terms queued successfully, starting queue processing');
        
        // Trigger the queue processing function
        try {
          console.log(`Triggering process-search-queue for job_id: ${job_id}`);
          
          // Make sure we properly await the response
          const queueResponse = await fetch(`${supabaseUrl}/functions/v1/process-search-queue`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${supabaseServiceKey}`
            },
            body: JSON.stringify({ job_id })
          });
          
          if (!queueResponse.ok) {
            const errorText = await queueResponse.text();
            console.error(`Failed to start queue processing. Status: ${queueResponse.status}, Error: ${errorText}`);
            
            // Update job status to indicate there was an issue
            await supabase
              .from('outline_generation_jobs')
              .update({ 
                status: 'error_starting_queue_processing',
                updated_at: new Date().toISOString()
              })
              .eq('id', job_id);
              
            // Add error status for UI
            await supabase
              .from('content_plan_outline_statuses')
              .insert({
                outline_guid: job_id,
                status: 'error_starting_queue_processing'
              });
          } else {
            console.log(`Successfully triggered queue processing for job_id: ${job_id}`);
            
            // Add status update for UI
            await supabase
              .from('content_plan_outline_statuses')
              .insert({
                outline_guid: job_id,
                status: 'search_queue_processing_started'
              });
          }
        } catch (queueError) {
          console.error(`Error triggering queue processing: ${queueError.message}`);
          
          // Update job status to indicate there was an issue
          await supabase
            .from('outline_generation_jobs')
            .update({ 
              status: 'error_starting_queue_processing',
              updated_at: new Date().toISOString()
            })
            .eq('id', job_id);
            
          // Add error status for UI
          await supabase
            .from('content_plan_outline_statuses')
            .insert({
              outline_guid: job_id,
              status: `error_starting_queue_processing: ${queueError.message.substring(0, 100)}`
            });
        }

      } catch (backgroundError) {
        console.error('Error in background search processing:', backgroundError);
        
        // Update job status to failed
        try {
          if (job_id) {
            const supabase = createClient(supabaseUrl, supabaseServiceKey);
            await supabase
              .from('outline_generation_jobs')
              .update({ 
                status: 'search_failed',
                updated_at: new Date().toISOString()
              })
              .eq('id', job_id);
              
            console.log(`Updated job ${job_id} status to search_failed due to background error`);
          }
        } catch (updateError) {
          console.error('Error updating job status:', updateError);
        }
      }
    })();
    
    // Return immediate response
    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Outline search process started', 
        job_id
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error processing outline search request:', error);
    
    // Update job status to failed if we have the job_id
    if (job_id) {
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
        const supabase = createClient(supabaseUrl, supabaseServiceKey);
        
        await supabase
          .from('outline_generation_jobs')
          .update({ 
            status: 'search_failed',
            updated_at: new Date().toISOString()
          })
          .eq('id', job_id);
          
        console.log(`Updated job ${job_id} status to search_failed due to request error`);
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