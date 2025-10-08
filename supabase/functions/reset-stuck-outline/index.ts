// supabase/functions/reset-stuck-outline/index.ts
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

  let job_id: string;
  
  try {
    const requestData = await req.json();
    job_id = requestData.content_plan_outline_guid || requestData.job_id;
    
    if (!job_id) {
      return new Response(
        JSON.stringify({ error: 'content_plan_outline_guid or job_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    console.log(`Reset stuck outline started for job_id: ${job_id}`);
    
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Validate that the job exists
    const { data: job, error: jobError } = await supabase
      .from('outline_generation_jobs')
      .select('*')
      .eq('id', job_id)
      .single();

    if (jobError || !job) {
      console.log(`Job not found in outline_generation_jobs, checking content_plan_outlines`);
      
      // Try to find the entry in content_plan_outlines
      const { data: outline, error: outlineError } = await supabase
        .from('content_plan_outlines')
        .select('*')
        .eq('guid', job_id)
        .single();
        
      if (outlineError || !outline) {
        return new Response(
          JSON.stringify({ error: `Job not found in either outline_generation_jobs or content_plan_outlines: ${jobError?.message || outlineError?.message || 'Unknown error'}` }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      console.log(`Found outline in content_plan_outlines with status: ${outline.status}`);
    } else {
      console.log(`Found job in outline_generation_jobs with status: ${job.status}`);
    }

    // Prepare for background processing
    (async () => {
      try {
        // Small delay to ensure the response is sent
        await new Promise(resolve => setTimeout(resolve, 200));
        
        console.log(`Beginning background reset for job_id: ${job_id}`);
        
        // Update job status in outline_generation_jobs if it exists
        try {
          const { data: updateJobResult } = await supabase
            .from('outline_generation_jobs')
            .update({ 
              status: 'pending',
              updated_at: new Date().toISOString()
            })
            .eq('id', job_id);
            
          if (updateJobResult) {
            console.log(`Reset outline_generation_jobs status to pending for job_id: ${job_id}`);
          }
        } catch (jobUpdateError) {
          console.log(`Failed to update outline_generation_jobs: ${jobUpdateError.message}`);
        }
          
        // Add status update
        try {
          await supabase
            .from('content_plan_outline_statuses')
            .insert({
              outline_guid: job_id,
              status: 'outline_reset_started'
            });
          console.log(`Added status update: outline_reset_started`);
        } catch (statusError) {
          console.log(`Failed to insert status update: ${statusError.message}`);
        }
          
        // Update the content_plan_outlines table with reset status
        try {
          const { data: updateOutlineResult } = await supabase
            .from('content_plan_outlines')
            .update({
              status: 'pending',
              updated_at: new Date().toISOString()
            })
            .eq('guid', job_id);
            
          if (updateOutlineResult) {
            console.log(`Reset content_plan_outlines status to pending for guid: ${job_id}`);
          }
        } catch (outlineUpdateError) {
          console.log(`Failed to update content_plan_outlines: ${outlineUpdateError.message}`);
        }
        
        // Clean up any partial data to ensure fresh generation
        console.log(`Cleaning up related data for job_id: ${job_id}`);
        
        // 1. Delete any existing search terms for this job
        try {
          const { error: deleteTermsError } = await supabase
            .from('outline_search_terms')
            .delete()
            .eq('job_id', job_id);
            
          if (!deleteTermsError) {
            console.log(`Deleted outline_search_terms for job_id: ${job_id}`);
          }
        } catch (deleteError) {
          console.log(`Failed to delete outline_search_terms: ${deleteError.message}`);
        }
        
        // 2. Delete any existing search results for this job
        try {
          const { error: deleteResultsError } = await supabase
            .from('outline_search_results')
            .delete()
            .eq('job_id', job_id);
            
          if (!deleteResultsError) {
            console.log(`Deleted outline_search_results for job_id: ${job_id}`);
          }
        } catch (deleteError) {
          console.log(`Failed to delete outline_search_results: ${deleteError.message}`);
        }
        
        // 3. Delete any existing URL analyses for this job
        try {
          const { error: deleteAnalysesError } = await supabase
            .from('outline_url_analyses')
            .delete()
            .eq('job_id', job_id);
            
          if (!deleteAnalysesError) {
            console.log(`Deleted outline_url_analyses for job_id: ${job_id}`);
          }
        } catch (deleteError) {
          console.log(`Failed to delete outline_url_analyses: ${deleteError.message}`);
        }
        
        // 4. Delete any existing items in search queue for this job
        try {
          const { error: deleteQueueError } = await supabase
            .from('outline_search_queue')
            .delete()
            .eq('job_id', job_id);
            
          if (!deleteQueueError) {
            console.log(`Deleted outline_search_queue items for job_id: ${job_id}`);
          }
        } catch (deleteError) {
          console.log(`Failed to delete outline_search_queue items: ${deleteError.message}`);
        }
        
        // Add final status update
        await supabase
          .from('content_plan_outline_statuses')
          .insert({
            outline_guid: job_id,
            status: 'reset_completed'
          });
        
        console.log(`Reset completed for job_id: ${job_id}. Job is ready for reprocessing.`);
        
        // Trigger reprocessing by calling process-outline-job
        try {
          console.log(`Triggering reprocessing for job_id: ${job_id}`);
          const processResponse = await fetch(
            `${Deno.env.get('SUPABASE_URL')}/functions/v1/process-outline-job`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
              },
              body: JSON.stringify({ job_id: job_id })
            }
          );

          if (processResponse.ok) {
            console.log(`Successfully triggered reprocessing for job_id: ${job_id}`);
            await supabase
              .from('content_plan_outline_statuses')
              .insert({
                outline_guid: job_id,
                status: 'reprocessing_started'
              });
          } else {
            const errorText = await processResponse.text();
            throw new Error(`Failed to trigger reprocessing: ${errorText}`);
          }
        } catch (processError) {
          console.error(`Error triggering reprocessing: ${processError.message}`);
          await supabase
            .from('content_plan_outline_statuses')
            .insert({
              outline_guid: job_id,
              status: `failed_to_trigger_reprocessing: ${processError.message.substring(0, 100)}`
            });
        }
      } catch (backgroundError) {
        console.error('Error in background reset processing:', backgroundError);
        
        // Update job status to failed
        try {
          const supabase = createClient(supabaseUrl, supabaseServiceKey);
          await supabase
            .from('outline_generation_jobs')
            .update({ 
              status: 'reset_failed',
              updated_at: new Date().toISOString()
            })
            .eq('id', job_id);
            
          // Add error status
          await supabase
            .from('content_plan_outline_statuses')
            .insert({
              outline_guid: job_id,
              status: `reset_failed: ${backgroundError.message.substring(0, 100)}`
            });
            
          console.log(`Updated job ${job_id} status to reset_failed due to background error`);
        } catch (updateError) {
          console.error('Error updating job status:', updateError);
        }
      }
    })();
    
    // Return immediate response
    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Outline reset process started', 
        job_id
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error processing outline reset request:', error);
    
    // Update job status to failed if we have the job_id
    if (job_id) {
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
        const supabase = createClient(supabaseUrl, supabaseServiceKey);
        
        await supabase
          .from('outline_generation_jobs')
          .update({ 
            status: 'reset_failed',
            updated_at: new Date().toISOString()
          })
          .eq('id', job_id);
          
        console.log(`Updated job ${job_id} status to reset_failed due to request error`);
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