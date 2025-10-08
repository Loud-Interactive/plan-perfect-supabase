import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

const FUNCTION_NAME = 'seo-content-saver';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Initialize Supabase client
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

interface ContentSaverRequest {
  workflowId: string;
}

interface ContentSaverResponse {
  success: boolean;
  workflowId: string;
  saved?: boolean;
  customSeoId?: string;
  error?: string;
}

// Save content to custom_seo_content table
async function saveCustomSeoContent(workflow: any): Promise<string> {
  try {
    console.log(`Saving custom SEO content for workflow ${workflow.id}`);
    
    // Prepare the data for custom_seo_content table
    const seoContentData = {
      page_id: workflow.page_id,
      url: workflow.url,
      business_unit: workflow.business_unit,
      schema_definition: {
        type: workflow.data_shape,
        fields_count: Object.keys(workflow.generated_content || {}).length
      },
      template_source: `workflow:${workflow.data_shape}`,
      generated_content: workflow.generated_content || {},
      model_used: 'deepseek-reasoner',
      thinking_log: workflow.workflow_metadata?.thinking_log || '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    // Use upsert to handle potential duplicates
    const { data: seoContent, error: seoError } = await supabase
      .from('custom_seo_content')
      .upsert(seoContentData, {
        onConflict: workflow.page_id ? 'page_id,business_unit' : undefined,
        ignoreDuplicates: false
      })
      .select()
      .single();
    
    if (seoError) {
      console.error('Error saving custom SEO content:', seoError);
      
      // If upsert fails due to unique constraint and no page_id, try insert with URL-based key
      if (!workflow.page_id && seoError.code === '23505') {
        // Try to find existing record by URL and business unit
        const { data: existing } = await supabase
          .from('custom_seo_content')
          .select('id')
          .eq('url', workflow.url)
          .eq('business_unit', workflow.business_unit || '')
          .single();
        
        if (existing) {
          // Update existing record
          const { data: updated, error: updateError } = await supabase
            .from('custom_seo_content')
            .update({
              generated_content: workflow.generated_content || {},
              thinking_log: workflow.workflow_metadata?.thinking_log || '',
              updated_at: new Date().toISOString()
            })
            .eq('id', existing.id)
            .select()
            .single();
          
          if (updateError) throw updateError;
          return updated.id;
        }
      }
      
      throw seoError;
    }
    
    console.log(`Saved custom SEO content with ID: ${seoContent.id}`);
    return seoContent.id;
    
  } catch (error) {
    console.error('Error in saveCustomSeoContent:', error);
    throw error;
  }
}

// Update workflow batch progress
async function updateBatchProgress(batchId: string) {
  try {
    if (!batchId) return;
    
    console.log(`Updating batch progress for batch ${batchId}`);
    
    // Get batch statistics
    const { data: stats, error } = await supabase
      .from('seo_workflows')
      .select('status')
      .eq('batch_id', batchId);
    
    if (error) {
      console.error('Error fetching batch stats:', error);
      return;
    }
    
    const total = stats.length;
    const completed = stats.filter(s => s.status === 'completed').length;
    const failed = stats.filter(s => s.status === 'failed').length;
    
    // Update batch record
    const batchStatus = completed === total ? 'completed' : 
                       (completed + failed === total ? 'failed' : 'processing');
    
    await supabase
      .from('seo_workflow_batches')
      .update({
        completed_urls: completed,
        failed_urls: failed,
        status: batchStatus,
        completed_at: batchStatus === 'completed' ? new Date().toISOString() : null
      })
      .eq('id', batchId);
    
    console.log(`Batch ${batchId} progress: ${completed}/${total} completed, ${failed} failed`);
    
  } catch (error) {
    console.error('Error updating batch progress:', error);
  }
}

// Process a single workflow
async function processWorkflow(workflowId: string): Promise<ContentSaverResponse> {
  try {
    console.log(`Processing content saving for workflow: ${workflowId}`);
    
    // Get workflow details
    const { data: workflow, error: fetchError } = await supabase
      .from('seo_workflows')
      .select('*')
      .eq('id', workflowId)
      .single();
    
    if (fetchError) {
      console.error('Error fetching workflow:', fetchError);
      throw fetchError;
    }
    
    if (!workflow) {
      throw new Error('Workflow not found');
    }
    
    // Update status to saving
    await supabase.rpc('update_workflow_status', {
      workflow_id: workflowId,
      new_status: 'saving',
      step_name: 'content-saver'
    });
    
    // Validate that we have generated content
    if (!workflow.generated_content || Object.keys(workflow.generated_content).length === 0) {
      throw new Error('No generated content found in workflow');
    }
    
    console.log(`Saving content for URL: ${workflow.url}`);
    
    // Save to custom_seo_content table
    const customSeoId = await saveCustomSeoContent(workflow);
    
    // Mark workflow as completed
    await supabase.rpc('update_workflow_status', {
      workflow_id: workflowId,
      new_status: 'completed'
    });
    
    // Update batch progress if this is part of a batch
    if (workflow.batch_id) {
      await updateBatchProgress(workflow.batch_id);
    }
    
    console.log(`Successfully completed workflow ${workflowId}`);
    
    return {
      success: true,
      workflowId: workflowId,
      saved: true,
      customSeoId: customSeoId
    };
    
  } catch (error) {
    console.error(`Error processing content saving for workflow ${workflowId}:`, error);
    
    // Mark workflow as failed
    await supabase.rpc('update_workflow_status', {
      workflow_id: workflowId,
      new_status: 'failed',
      error_msg: error.message
    });
    
    // Update batch progress even for failed workflows
    const { data: workflow } = await supabase
      .from('seo_workflows')
      .select('batch_id')
      .eq('id', workflowId)
      .single();
    
    if (workflow?.batch_id) {
      await updateBatchProgress(workflow.batch_id);
    }
    
    return {
      success: false,
      workflowId: workflowId,
      error: error.message
    };
  }
}

// Get workflow results for API response
async function getWorkflowResults(workflowId: string): Promise<any> {
  try {
    // Get workflow with generated content
    const { data: workflow, error } = await supabase
      .from('seo_workflows')
      .select(`
        *,
        custom_seo_content (
          id,
          generated_content,
          thinking_log,
          created_at
        )
      `)
      .eq('id', workflowId)
      .single();
    
    if (error) {
      console.error('Error fetching workflow results:', error);
      return null;
    }
    
    return {
      workflowId: workflow.id,
      url: workflow.url,
      status: workflow.status,
      businessUnit: workflow.business_unit,
      dataShape: workflow.data_shape,
      keywords: workflow.keywords,
      generatedContent: workflow.generated_content,
      customSeoId: workflow.custom_seo_content?.[0]?.id,
      completedAt: workflow.completed_at,
      error: workflow.error_message
    };
    
  } catch (error) {
    console.error('Error getting workflow results:', error);
    return null;
  }
}

// Main handler
serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const request: ContentSaverRequest = await req.json();
    const { workflowId } = request;
    
    if (!workflowId) {
      throw new Error('workflowId is required');
    }
    
    console.log(`=== SEO Content Saver - Processing Workflow ${workflowId} ===`);
    
    const response = await processWorkflow(workflowId);
    
    // Add workflow results to response if successful
    if (response.success) {
      const results = await getWorkflowResults(workflowId);
      if (results) {
        (response as any).results = results;
      }
    }
    
    return new Response(
      JSON.stringify(response),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: response.success ? 200 : 400,
      }
    );

  } catch (error) {
    console.error('Error in seo-content-saver:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});