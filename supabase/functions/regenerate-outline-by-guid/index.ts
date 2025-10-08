// supabase/functions/regenerate-outline-by-guid/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  let content_plan_outline_guid: string;
  
  try {
    const requestData = await req.json();
    content_plan_outline_guid = requestData.content_plan_outline_guid;
    
    if (!content_plan_outline_guid) {
      return new Response(
        JSON.stringify({ error: 'content_plan_outline_guid is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    console.log(`Regenerate outline by GUID started for: ${content_plan_outline_guid}`);
    
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // First, find the outline record to get the job_id
    const { data: outlineData, error: outlineError } = await supabase
      .from('content_plan_outlines')
      .select('guid, job_id, title, keyword, content_plan_keyword, domain')
      .eq('guid', content_plan_outline_guid)
      .single();

    if (outlineError || !outlineData) {
      return new Response(
        JSON.stringify({ 
          error: `Outline not found for GUID: ${content_plan_outline_guid}`,
          details: outlineError?.message || 'Unknown error'
        }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Found outline record with job_id: ${outlineData.job_id}`);

    // Check if there's an existing job in outline_generation_jobs
    let job_id = outlineData.job_id;
    let { data: existingJob, error: jobLookupError } = await supabase
      .from('outline_generation_jobs')
      .select('*')
      .eq('id', job_id)
      .single();

    // If no existing job found, create a new one
    if (jobLookupError || !existingJob) {
      console.log(`No existing job found for job_id: ${job_id}, creating new regeneration job`);
      
      const { data: newJob, error: createJobError } = await supabase
        .from('outline_generation_jobs')
        .insert({
          post_title: outlineData.title || `Regenerated outline for ${content_plan_outline_guid}`,
          post_keyword: outlineData.keyword || '',
          content_plan_keyword: outlineData.content_plan_keyword || '',
          domain: outlineData.domain || '',
          status: 'pending_regeneration',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select('*')
        .single();

      if (createJobError || !newJob) {
        return new Response(
          JSON.stringify({ 
            error: `Failed to create regeneration job`,
            details: createJobError?.message || 'Unknown error'
          }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      job_id = newJob.id;
      existingJob = newJob;
      
      // Update the outline record with the new job_id
      await supabase
        .from('content_plan_outlines')
        .update({ job_id: job_id })
        .eq('guid', content_plan_outline_guid);
        
      console.log(`Created new job with id: ${job_id}`);
    }

    console.log(`Using job_id: ${job_id} for regeneration process`);

    // Now call the existing regenerate-outline function
    const regenerateUrl = `${supabaseUrl}/functions/v1/regenerate-outline`;
    const regenerateResponse = await fetch(regenerateUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        job_id: job_id,
        content_plan_outline_guid: content_plan_outline_guid
      })
    });

    if (!regenerateResponse.ok) {
      const errorText = await regenerateResponse.text();
      console.error(`Error calling regenerate-outline: ${regenerateResponse.status} - ${errorText}`);
      
      return new Response(
        JSON.stringify({ 
          error: `Failed to start regeneration process`,
          details: `HTTP ${regenerateResponse.status}: ${errorText}`
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const regenerateResult = await regenerateResponse.json();
    
    console.log(`Successfully initiated regeneration for GUID: ${content_plan_outline_guid}, job_id: ${job_id}`);
    
    // Return success response
    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Outline regeneration process started successfully', 
        content_plan_outline_guid: content_plan_outline_guid,
        job_id: job_id,
        outline_title: outlineData.title,
        regeneration_result: regenerateResult
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    console.error('Error processing regenerate-outline-by-guid request:', error);
    
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error',
        details: error.message 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});