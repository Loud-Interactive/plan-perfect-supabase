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
    const { content_plan_guid, post_title, content_plan_keyword, post_keyword, domain } = await req.json();
    
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
        status: 'started'
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
      console.log(`Attempting to start search-outline-content for job_id: ${job.id}`);
      
      // Add status record for search initialization
      await supabase
        .from('content_plan_outline_statuses')
        .insert({
          outline_guid: job.id,
          status: 'initializing_search_process'
        });
      
      // Make sure we properly await the response
      const searchResponse = await fetch(`${supabaseUrl}/functions/v1/search-outline-content`, {
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
        console.error(`Failed to start search-outline-content. Status: ${searchResponse.status}, Error: ${errorText}`);
        
        // Update job status to indicate there was an issue starting the process
        await supabase
          .from('outline_generation_jobs')
          .update({ 
            status: 'error_starting_search',
            updated_at: new Date().toISOString()
          })
          .eq('id', job.id);
          
        // Add error status for UI
        await supabase
          .from('content_plan_outline_statuses')
          .insert({
            outline_guid: job.id,
            status: 'error_initializing_search_process'
          });
          
        console.log(`Updated job ${job.id} status to error_starting_search`);
      } else {
        // Add success status for UI
        await supabase
          .from('content_plan_outline_statuses')
          .insert({
            outline_guid: job.id,
            status: 'search_process_started'
          });
          
        console.log(`Successfully started search-outline-content for job_id: ${job.id}`);
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