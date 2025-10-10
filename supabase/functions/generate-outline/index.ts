// supabase/functions/generate-outline/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { content_plan_guid, post_title, content_plan_keyword, post_keyword, domain, fast = false } = await req.json();

    if (!post_title || !content_plan_keyword || !post_keyword || !domain) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Create a new job in outline_generation_jobs
    const { data: job, error: jobError } = await supabase
      .from('outline_generation_jobs')
      .insert({
        content_plan_guid,
        post_title,
        content_plan_keyword,
        post_keyword,
        domain,
        status: 'started',
        fast_mode: fast
      })
      .select()
      .single();

    if (jobError) {
      throw new Error(`Failed to create job: ${jobError.message}`);
    }

    // Add initial status record
    await supabase
      .from('content_plan_outline_statuses')
      .insert({
        outline_guid: job.id,
        status: 'outline_generation_started'
      });
      
    // Insert initial record into content_plan_outlines with job_id as guid
    await supabase
      .from('content_plan_outlines')
      .insert({
        guid: job.id,
        content_plan_guid: content_plan_guid,
        post_title: post_title,
        domain: domain,
        status: 'pending',
        keyword: post_keyword
      });

    // Start the search process
    try {
      // Route to appropriate function based on fast mode
      const targetFunction = fast ? 'fast-outline-search' : 'search-outline-content';
      const targetStatus = fast ? 'fast_search_started' : 'initializing_search_process';

      console.log(`Attempting to start ${targetFunction} for job_id: ${job.id}`);

      // Add status record for search initialization
      await supabase
        .from('content_plan_outline_statuses')
        .insert({
          outline_guid: job.id,
          status: targetStatus
        });

      // Make sure we properly await the response
      const searchResponse = await fetch(`${supabaseUrl}/functions/v1/${targetFunction}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseServiceKey}`
        },
        body: JSON.stringify({ job_id: job.id })
      });
      
      // Check if the response is ok (status in the range 200-299)
      if (!searchResponse.ok) {
        const errorText = await searchResponse.text();
        console.error(`Failed to start ${targetFunction}. Status: ${searchResponse.status}, Error: ${errorText}`);

        // If fast mode failed, optionally retry with slow mode
        if (fast) {
          console.log('Fast mode failed, falling back to slow mode');
          await supabase
            .from('content_plan_outline_statuses')
            .insert({
              outline_guid: job.id,
              status: 'fast_mode_failed_retrying_slow'
            });

          // Retry with slow mode
          const fallbackResponse = await fetch(`${supabaseUrl}/functions/v1/search-outline-content`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${supabaseServiceKey}`
            },
            body: JSON.stringify({ job_id: job.id })
          });

          if (!fallbackResponse.ok) {
            // Both failed, mark job as error
            await supabase
              .from('outline_generation_jobs')
              .update({
                status: 'error_starting_search',
                updated_at: new Date().toISOString()
              })
              .eq('id', job.id);

            await supabase
              .from('content_plan_outline_statuses')
              .insert({
                outline_guid: job.id,
                status: 'error_both_fast_and_slow_failed'
              });
          } else {
            await supabase
              .from('content_plan_outline_statuses')
              .insert({
                outline_guid: job.id,
                status: 'slow_mode_fallback_started'
              });
          }
        } else {
          // Slow mode failed, mark as error
          await supabase
            .from('outline_generation_jobs')
            .update({
              status: 'error_starting_search',
              updated_at: new Date().toISOString()
            })
            .eq('id', job.id);

          await supabase
            .from('content_plan_outline_statuses')
            .insert({
              outline_guid: job.id,
              status: 'error_initializing_search_process'
            });
        }

        console.log(`Updated job ${job.id} status after error`);
      } else {
        // Add success status for UI
        const successStatus = fast ? 'fast_search_process_started' : 'search_process_started';
        await supabase
          .from('content_plan_outline_statuses')
          .insert({
            outline_guid: job.id,
            status: successStatus
          });

        console.log(`Successfully started ${targetFunction} for job_id: ${job.id}`);
      }
    } catch (searchError) {
      console.error(`Error starting search-outline-content: ${searchError.message}`);
      
      // Update job status to indicate there was an error
      await supabase
        .from('outline_generation_jobs')
        .update({ 
          status: 'error_starting_search',
          updated_at: new Date().toISOString()
        })
        .eq('id', job.id);
        
      // Add error status for UI with details
      await supabase
        .from('content_plan_outline_statuses')
        .insert({
          outline_guid: job.id,
          status: `error_starting_search: ${searchError.message.substring(0, 100)}`
        });
        
      console.log(`Updated job ${job.id} status to error_starting_search due to exception`);
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Outline generation started', 
        job_id: job.id,
        content_plan_outline_guid: job.id 
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in generate-outline function:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});