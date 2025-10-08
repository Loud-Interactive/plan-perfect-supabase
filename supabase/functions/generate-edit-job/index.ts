// supabase/functions/generate-edit-job/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.4.0'
import Anthropic from 'npm:@anthropic-ai/sdk';

serve(async (req) => {
  // Set CORS headers for all responses
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  }

  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders, status: 204 })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  
  try {
    // Parse the request body
    const { 
      content_plan_outline_guid,
      editType = "style", // Default to style transformation
      check_status = false // Flag to check status of an existing job
    } = await req.json()
    
    // If checking status of an existing job
    if (check_status && content_plan_outline_guid) {
      console.log(`Checking status for job related to outline GUID: ${content_plan_outline_guid}`);
      
      // Initialize Supabase client
      const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
      const supabase = createClient(supabaseUrl, supabaseKey);
      
      // Get the document and job status
      const { data: documentData, error: documentError } = await supabase
        .from('documents')
        .select('*, edit_jobs(*)')
        .eq('content_plan_outline_guid', content_plan_outline_guid)
        .eq('is_deleted', false)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      
      if (documentError) {
        console.error('Error fetching document status:', documentError);
        return new Response(JSON.stringify({ 
          error: `Failed to fetch document status: ${documentError.message}` 
        }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      // Return the status
      return new Response(JSON.stringify({ 
        success: true,
        document: {
          id: documentData.id,
          title: documentData.title,
          content_plan_outline_guid: documentData.content_plan_outline_guid,
          created_at: documentData.created_at
        },
        job: documentData.edit_jobs[0] || null
      }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      });
    }
    
    // Validate request parameters for a new job
    if (!content_plan_outline_guid) {
      return new Response(JSON.stringify({ error: 'Content plan outline GUID is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    console.log(`Processing edit job for outline GUID: ${content_plan_outline_guid}, type: ${editType}`)
    
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // First try to get content from tasks table where content_plan_outline_guid matches
    const { data: taskData, error: taskError } = await supabase
      .from('tasks')
      .select('*')
      .eq('content_plan_outline_guid', content_plan_outline_guid)
      .order('created_at', { ascending: false })
      .limit(1);

    let content = '';
    let title = '';
    let domain = '';
    
    if (!taskError && taskData && taskData.length > 0) {
      // Get data from task
      content = taskData[0].content || '';
      title = taskData[0].title || '';
      domain = taskData[0].domain || '';
      
      console.log(`Found task data for outline GUID: ${content_plan_outline_guid}`);
    } else {
      // Fallback to content_plan_outlines table
      console.log(`No task data found, trying content_plan_outlines for GUID: ${content_plan_outline_guid}`);
      
      const { data: outlineData, error: outlineError } = await supabase
        .from('content_plan_outlines')
        .select('*')
        .eq('guid', content_plan_outline_guid)
        .single();
      
      if (outlineError || !outlineData) {
        console.error('Error fetching outline:', outlineError);
        return new Response(JSON.stringify({ 
          error: `Failed to fetch content: No task or outline found for GUID ${content_plan_outline_guid}` 
        }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      // Get the content from the outline
      content = outlineData.content || '';
      title = outlineData.title || '';
      domain = outlineData.custom_domain || '';
      
      if (!domain && outlineData.content_plan_guid) {
        const { data: contentPlanData, error: contentPlanError } = await supabase
          .from('content_plans')
          .select('client_id')
          .eq('guid', outlineData.content_plan_guid)
          .single();
        
        if (!contentPlanError && contentPlanData) {
          domain = contentPlanData.client_id;
        }
      }
    }
    
    // Validate we have content
    if (!content) {
      return new Response(JSON.stringify({ error: 'Content is empty' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    console.log(`Creating document record for outline: ${title}, domain: ${domain}`);
    
    // Create a document record
    const { data: documentData, error: documentError } = await supabase
      .from('documents')
      .insert({
        title: title,
        content: content,
        domain: domain,
        content_plan_outline_guid: content_plan_outline_guid
      })
      .select()
      .single();
    
    if (documentError) {
      console.error('Error creating document:', documentError);
      return new Response(JSON.stringify({ 
        error: `Failed to create document: ${documentError.message}` 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    console.log(`Document created with ID: ${documentData.id}`);
    
    // Fetch style guide if needed
    let styleGuide = null;
    
    if (domain) {
      // Try to get the style guide from preferences_perfect table
      const { data: styleGuideData, error: styleGuideError } = await supabase
        .from('preferences_perfect')
        .select('ai_style_guide')
        .eq('domain', domain)
        .single();
      
      if (!styleGuideError && styleGuideData && styleGuideData.ai_style_guide) {
        styleGuide = styleGuideData.ai_style_guide;
        console.log(`Found style guide for domain: ${domain}`);
      } else {
        console.log(`No style guide found for domain: ${domain}, will use generic style guide`);
      }
    }
    
    // Create an edit job
    const { data: editJobData, error: editJobError } = await supabase
      .from('edit_jobs')
      .insert({
        document_id: documentData.id,
        style: editType,
        status: 'pending',
        original_content: content
      })
      .select()
      .single();
    
    if (editJobError) {
      console.error('Error creating edit job:', editJobError);
      return new Response(JSON.stringify({ 
        error: `Failed to create edit job: ${editJobError.message}` 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    console.log(`Edit job created with ID: ${editJobData.id}`);
    
    // Start processing the edit job asynchronously
    if (editType === 'style') {
      // Call the process-style-transformation function
      console.log(`Triggering style transformation for job ID: ${editJobData.id}`);
      
      fetch(`${supabaseUrl}/functions/v1/process-style-transformation`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          job_id: editJobData.id
        })
      }).catch(error => {
        console.error('Error triggering style transformation:', error);
      });
    }
    
    // Return success response with the created job
    return new Response(JSON.stringify({ 
      success: true,
      document: documentData,
      job: editJobData
    }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });
  } catch (error) {
    console.error('Error in generate-edit-job function:', error);
    
    return new Response(
      JSON.stringify({ 
        error: `Failed to process edit job: ${error.message}` 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    );
  }
})