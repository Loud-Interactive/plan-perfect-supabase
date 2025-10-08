import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

const FUNCTION_NAME = 'seo-workflow-orchestrator';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Initialize Supabase client
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

interface SEOWorkflowRequest {
  // Single URL processing
  url?: string;
  pageId?: string;
  
  // Bulk processing
  urls?: string[];
  batchName?: string;
  batchDescription?: string;
  
  // Common parameters
  businessUnit?: string;
  dataShape?: string;
  existingData?: any;
  priority?: number;
  maxRetries?: number;
  
  // Operation type
  operation: 'create' | 'status' | 'retry' | 'cancel';
  
  // For status/retry/cancel operations
  workflowId?: string;
  batchId?: string;
}

interface WorkflowResponse {
  success: boolean;
  workflowId?: string;
  batchId?: string;
  status?: string;
  progress?: {
    total: number;
    completed: number;
    failed: number;
    inProgress: number;
    percentage: number;
  };
  results?: any[];
  error?: string;
}

// Create a single workflow
async function createSingleWorkflow(request: SEOWorkflowRequest): Promise<WorkflowResponse> {
  try {
    const { url, pageId, businessUnit, dataShape, existingData, priority, maxRetries } = request;
    
    if (!url && !pageId) {
      throw new Error('Either url or pageId is required');
    }
    
    // Insert workflow record
    const { data: workflow, error: insertError } = await supabase
      .from('seo_workflows')
      .insert({
        url: url || '',
        page_id: pageId || null,
        status: 'pending',
        current_step: 'orchestrator',
        business_unit: businessUnit || null,
        data_shape: dataShape || 'oriental trading',
        existing_data: existingData || {},
        priority: priority || 1,
        max_retries: maxRetries || 3,
        workflow_metadata: {
          created_by: 'orchestrator',
          request_timestamp: new Date().toISOString()
        }
      })
      .select()
      .single();
    
    if (insertError) {
      console.error('Error creating workflow:', insertError);
      throw insertError;
    }
    
    console.log(`Created workflow ${workflow.id} for ${url || pageId}`);
    
    // Start the workflow by calling the first step
    await triggerNextStep(workflow.id, 'crawling');
    
    return {
      success: true,
      workflowId: workflow.id,
      status: 'pending'
    };
  } catch (error) {
    console.error('Error in createSingleWorkflow:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Create batch workflows
async function createBatchWorkflows(request: SEOWorkflowRequest): Promise<WorkflowResponse> {
  try {
    const { urls, batchName, batchDescription, businessUnit, dataShape, priority } = request;
    
    if (!urls || urls.length === 0) {
      throw new Error('URLs array is required and cannot be empty');
    }
    
    // Create batch using database function
    const { data, error } = await supabase.rpc('create_seo_batch', {
      batch_name: batchName || `Batch ${new Date().toISOString()}`,
      urls: urls,
      batch_description: batchDescription || null,
      batch_priority: priority || 1,
      batch_business_unit: businessUnit || null,
      batch_data_shape: dataShape || 'oriental trading'
    });
    
    if (error) {
      console.error('Error creating batch:', error);
      throw error;
    }
    
    const batchId = data;
    console.log(`Created batch ${batchId} with ${urls.length} URLs`);
    
    // Start processing workflows in this batch
    await processBatchWorkflows(batchId);
    
    return {
      success: true,
      batchId: batchId,
      status: 'processing',
      progress: {
        total: urls.length,
        completed: 0,
        failed: 0,
        inProgress: urls.length,
        percentage: 0
      }
    };
  } catch (error) {
    console.error('Error in createBatchWorkflows:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Process batch workflows (trigger crawling for multiple workflows)
async function processBatchWorkflows(batchId: string) {
  try {
    // Get all pending workflows in this batch
    const { data: workflows, error } = await supabase
      .from('seo_workflows')
      .select('id')
      .eq('batch_id', batchId)
      .eq('status', 'pending')
      .order('priority', { ascending: false })
      .order('created_at', { ascending: true });
    
    if (error) {
      console.error('Error fetching batch workflows:', error);
      return;
    }
    
    console.log(`Processing ${workflows.length} workflows in batch ${batchId}`);
    
    // Trigger crawling for each workflow (with some staggering to avoid overwhelming)
    const promises = workflows.map(async (workflow, index) => {
      // Stagger requests slightly to avoid hitting rate limits
      await new Promise(resolve => setTimeout(resolve, index * 100));
      return triggerNextStep(workflow.id, 'crawling');
    });
    
    await Promise.allSettled(promises);
    
  } catch (error) {
    console.error('Error processing batch workflows:', error);
  }
}

// Trigger the next step in the workflow
async function triggerNextStep(workflowId: string, nextStep: string) {
  try {
    const stepFunctions = {
      'crawling': 'seo-page-crawler',
      'researching': 'seo-keyword-researcher', 
      'generating': 'seo-content-generator',
      'saving': 'seo-content-saver'
    };
    
    const functionName = stepFunctions[nextStep as keyof typeof stepFunctions];
    if (!functionName) {
      throw new Error(`Unknown workflow step: ${nextStep}`);
    }
    
    console.log(`Triggering ${functionName} for workflow ${workflowId}`);
    
    // Update workflow status
    await supabase.rpc('update_workflow_status', {
      workflow_id: workflowId,
      new_status: nextStep,
      step_name: nextStep
    });
    
    // Call the next function asynchronously
    fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseServiceKey}`
      },
      body: JSON.stringify({ workflowId })
    }).catch(error => {
      console.error(`Error calling ${functionName}:`, error);
      // Mark workflow as failed
      supabase.rpc('update_workflow_status', {
        workflow_id: workflowId,
        new_status: 'failed',
        error_msg: `Failed to trigger ${functionName}: ${error.message}`
      });
    });
    
  } catch (error) {
    console.error('Error triggering next step:', error);
    throw error;
  }
}

// Get workflow or batch status
async function getWorkflowStatus(request: SEOWorkflowRequest): Promise<WorkflowResponse> {
  try {
    if (request.workflowId) {
      // Get single workflow status
      const { data: workflow, error } = await supabase
        .from('seo_workflows')
        .select('*')
        .eq('id', request.workflowId)
        .single();
      
      if (error) throw error;
      
      return {
        success: true,
        workflowId: workflow.id,
        status: workflow.status,
        results: workflow.status === 'completed' ? [workflow] : undefined
      };
      
    } else if (request.batchId) {
      // Get batch status
      const { data: progress, error } = await supabase
        .from('batch_progress')
        .select('*')
        .eq('id', request.batchId)
        .single();
      
      if (error) throw error;
      
      return {
        success: true,
        batchId: request.batchId,
        status: progress.completion_percentage === 100 ? 'completed' : 'processing',
        progress: {
          total: progress.total_urls,
          completed: progress.completed,
          failed: progress.failed,
          inProgress: progress.in_progress,
          percentage: progress.completion_percentage
        }
      };
    } else {
      throw new Error('Either workflowId or batchId is required for status check');
    }
  } catch (error) {
    console.error('Error getting workflow status:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Retry failed workflow
async function retryWorkflow(request: SEOWorkflowRequest): Promise<WorkflowResponse> {
  try {
    const { workflowId } = request;
    
    if (!workflowId) {
      throw new Error('workflowId is required for retry');
    }
    
    // Get workflow
    const { data: workflow, error } = await supabase
      .from('seo_workflows')
      .select('*')
      .eq('id', workflowId)
      .single();
    
    if (error) throw error;
    
    if (workflow.status !== 'failed') {
      throw new Error(`Cannot retry workflow with status: ${workflow.status}`);
    }
    
    if (workflow.retry_count >= workflow.max_retries) {
      throw new Error('Maximum retries exceeded');
    }
    
    // Reset workflow to pending and increment retry count
    await supabase.rpc('update_workflow_status', {
      workflow_id: workflowId,
      new_status: 'pending',
      step_name: 'orchestrator',
      increment_retries: true
    });
    
    // Start from the beginning
    await triggerNextStep(workflowId, 'crawling');
    
    return {
      success: true,
      workflowId: workflowId,
      status: 'pending'
    };
  } catch (error) {
    console.error('Error retrying workflow:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Cancel workflow
async function cancelWorkflow(request: SEOWorkflowRequest): Promise<WorkflowResponse> {
  try {
    const { workflowId, batchId } = request;
    
    if (workflowId) {
      // Cancel single workflow
      await supabase.rpc('update_workflow_status', {
        workflow_id: workflowId,
        new_status: 'failed',
        error_msg: 'Cancelled by user'
      });
      
      return {
        success: true,
        workflowId: workflowId,
        status: 'cancelled'
      };
    } else if (batchId) {
      // Cancel all workflows in batch
      const { error } = await supabase
        .from('seo_workflows')
        .update({ 
          status: 'failed', 
          error_message: 'Batch cancelled by user',
          updated_at: new Date().toISOString()
        })
        .eq('batch_id', batchId)
        .in('status', ['pending', 'crawling', 'researching', 'generating', 'saving']);
      
      if (error) throw error;
      
      return {
        success: true,
        batchId: batchId,
        status: 'cancelled'
      };
    } else {
      throw new Error('Either workflowId or batchId is required for cancellation');
    }
  } catch (error) {
    console.error('Error cancelling workflow:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Main handler
serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const request: SEOWorkflowRequest = await req.json();
    const { operation } = request;
    
    console.log(`=== SEO Workflow Orchestrator - ${operation} ===`);
    
    let response: WorkflowResponse;
    
    switch (operation) {
      case 'create':
        if (request.urls && request.urls.length > 1) {
          response = await createBatchWorkflows(request);
        } else {
          response = await createSingleWorkflow(request);
        }
        break;
        
      case 'status':
        response = await getWorkflowStatus(request);
        break;
        
      case 'retry':
        response = await retryWorkflow(request);
        break;
        
      case 'cancel':
        response = await cancelWorkflow(request);
        break;
        
      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
    
    return new Response(
      JSON.stringify(response),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: response.success ? 200 : 400,
      }
    );

  } catch (error) {
    console.error('Error in seo-workflow-orchestrator:', error);
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