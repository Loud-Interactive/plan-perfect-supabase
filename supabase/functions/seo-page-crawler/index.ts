import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

const FUNCTION_NAME = 'seo-page-crawler';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Initialize Supabase client
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

interface CrawlerRequest {
  workflowId: string;
}

interface CrawlerResponse {
  success: boolean;
  workflowId: string;
  pageId?: string;
  nextStep?: string;
  error?: string;
}

// Check if page already exists in database
async function findExistingPage(url: string): Promise<any> {
  const { data: pages, error } = await supabase
    .from('pages')
    .select('*')
    .eq('url', url)
    .order('crawled_at', { ascending: false })
    .limit(1);
  
  if (error) {
    console.error('Error checking existing pages:', error);
    return null;
  }
  
  return pages && pages.length > 0 ? pages[0] : null;
}

// Crawl page using existing crawl-page-html function
async function crawlPage(url: string): Promise<any> {
  try {
    console.log(`Crawling page: ${url}`);
    
    // Call the existing crawl function
    const crawlResponse = await fetch(`${supabaseUrl}/functions/v1/crawl-page-html`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseServiceKey}`
      },
      body: JSON.stringify({ url })
    });
    
    if (!crawlResponse.ok) {
      const errorText = await crawlResponse.text();
      throw new Error(`Crawl request failed: ${errorText}`);
    }
    
    const crawlResult = await crawlResponse.json();
    
    if (!crawlResult.success) {
      throw new Error(`Crawl failed: ${crawlResult.error || 'Unknown error'}`);
    }
    
    return crawlResult;
  } catch (error) {
    console.error('Error crawling page:', error);
    throw error;
  }
}

// Create page record in database
async function createPageRecord(url: string, crawlResult: any): Promise<string> {
  try {
    const urlObj = new URL(url);
    const domain = urlObj.hostname;
    
    const pageData = {
      url: url,
      domain: domain,
      html: crawlResult.html || '',
      html_length: crawlResult.htmlLength || 0,
      status_code: crawlResult.statusCode || 200,
      title: crawlResult.title || '',
      meta_description: crawlResult.metaDescription || '',
      h1: crawlResult.h1 || '',
      crawled_at: new Date().toISOString()
    };
    
    // Try to insert, handle duplicates gracefully
    const { data: newPage, error: createError } = await supabase
      .from('pages')
      .upsert(pageData, {
        onConflict: 'url',
        ignoreDuplicates: false
      })
      .select()
      .single();
    
    if (createError) {
      console.error('Error creating page record:', createError);
      
      // If upsert fails, try to find existing page
      const existingPage = await findExistingPage(url);
      if (existingPage) {
        return existingPage.id;
      }
      
      throw createError;
    }
    
    console.log(`Created/updated page record: ${newPage.id}`);
    return newPage.id;
    
  } catch (error) {
    console.error('Error creating page record:', error);
    throw error;
  }
}

// Process a single workflow
async function processWorkflow(workflowId: string): Promise<CrawlerResponse> {
  try {
    console.log(`Processing workflow: ${workflowId}`);
    
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
    
    console.log(`Processing URL: ${workflow.url}`);
    
    // Update status to crawling
    await supabase.rpc('update_workflow_status', {
      workflow_id: workflowId,
      new_status: 'crawling',
      step_name: 'page-crawler'
    });
    
    let pageId = workflow.page_id;
    
    // If no page_id, check if page exists or needs crawling
    if (!pageId) {
      console.log('No page_id found, checking for existing page...');
      
      // Check if page already exists
      const existingPage = await findExistingPage(workflow.url);
      
      if (existingPage) {
        console.log(`Found existing page: ${existingPage.id}`);
        pageId = existingPage.id;
        
        // Update workflow with page_id
        await supabase
          .from('seo_workflows')
          .update({ page_id: pageId })
          .eq('id', workflowId);
      } else {
        console.log('Page not found, crawling...');
        
        // Crawl the page
        const crawlResult = await crawlPage(workflow.url);
        
        // Create page record
        pageId = await createPageRecord(workflow.url, crawlResult);
        
        // Update workflow with page_id
        await supabase
          .from('seo_workflows')
          .update({ page_id: pageId })
          .eq('id', workflowId);
      }
    } else {
      console.log(`Using existing page_id: ${pageId}`);
    }
    
    // Move to next step
    await triggerNextStep(workflowId, 'researching');
    
    return {
      success: true,
      workflowId: workflowId,
      pageId: pageId,
      nextStep: 'researching'
    };
    
  } catch (error) {
    console.error(`Error processing workflow ${workflowId}:`, error);
    
    // Mark workflow as failed
    await supabase.rpc('update_workflow_status', {
      workflow_id: workflowId,
      new_status: 'failed',
      error_msg: error.message
    });
    
    return {
      success: false,
      workflowId: workflowId,
      error: error.message
    };
  }
}

// Trigger next step in workflow
async function triggerNextStep(workflowId: string, nextStep: string) {
  try {
    console.log(`Triggering next step: ${nextStep} for workflow ${workflowId}`);
    
    // Update workflow status
    await supabase.rpc('update_workflow_status', {
      workflow_id: workflowId,
      new_status: nextStep,
      step_name: nextStep
    });
    
    // Call the keyword researcher function
    const response = await fetch(`${supabaseUrl}/functions/v1/seo-keyword-researcher`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseServiceKey}`
      },
      body: JSON.stringify({ workflowId })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to trigger keyword researcher: ${errorText}`);
    }
    
  } catch (error) {
    console.error('Error triggering next step:', error);
    
    // Mark workflow as failed
    await supabase.rpc('update_workflow_status', {
      workflow_id: workflowId,
      new_status: 'failed',
      error_msg: `Failed to trigger next step: ${error.message}`
    });
  }
}

// Main handler
serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const request: CrawlerRequest = await req.json();
    const { workflowId } = request;
    
    if (!workflowId) {
      throw new Error('workflowId is required');
    }
    
    console.log(`=== SEO Page Crawler - Processing Workflow ${workflowId} ===`);
    
    const response = await processWorkflow(workflowId);
    
    return new Response(
      JSON.stringify(response),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: response.success ? 200 : 400,
      }
    );

  } catch (error) {
    console.error('Error in seo-page-crawler:', error);
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