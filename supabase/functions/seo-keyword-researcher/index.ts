import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

const FUNCTION_NAME = 'seo-keyword-researcher';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Initialize Supabase client
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

interface KeywordResearchRequest {
  workflowId: string;
}

interface KeywordResearchResponse {
  success: boolean;
  workflowId: string;
  keywordCount?: number;
  nextStep?: string;
  error?: string;
}

// Get existing GSC keywords from database
async function getExistingGSCKeywords(pageId: string, url: string): Promise<any[]> {
  try {
    console.log(`Fetching existing GSC keywords for page ${pageId} / ${url}`);
    
    // Try by page_id first, then by URL
    const { data: keywords, error } = await supabase
      .from('gsc_keywords')
      .select('keyword, clicks, impressions, position')
      .or(`page_id.eq.${pageId},page_url.eq.${url}`)
      .order('impressions', { ascending: false })
      .limit(50);
    
    if (error) {
      console.error('Error fetching GSC keywords:', error);
      return [];
    }
    
    console.log(`Found ${keywords?.length || 0} existing GSC keywords`);
    return keywords || [];
    
  } catch (error) {
    console.error('Error in getExistingGSCKeywords:', error);
    return [];
  }
}

// Fetch fresh GSC data using existing function
async function fetchGSCData(pageId: string, url: string): Promise<any[]> {
  try {
    console.log(`Fetching fresh GSC data for ${url}`);
    
    // Call existing GSC function
    const gscResponse = await fetch(`${supabaseUrl}/functions/v1/fetch-gsc-data`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseServiceKey}`
      },
      body: JSON.stringify({
        pageId: pageId,
        url: url
      })
    });
    
    if (!gscResponse.ok) {
      console.log(`GSC fetch failed: ${gscResponse.status}`);
      return [];
    }
    
    const gscResult = await gscResponse.json();
    
    if (gscResult.success && gscResult.gsc_data && gscResult.gsc_data.top_keywords) {
      console.log(`Fetched ${gscResult.gsc_data.top_keywords.length} fresh GSC keywords`);
      return gscResult.gsc_data.top_keywords;
    }
    
    return [];
    
  } catch (error) {
    console.error('Error fetching fresh GSC data:', error);
    return [];
  }
}

// Generate AI keywords using existing function
async function generateAIKeywords(pageId: string, pageContent: string): Promise<any[]> {
  try {
    if (!pageContent || pageContent.length < 100) {
      console.log('Insufficient page content for AI keyword generation');
      return [];
    }
    
    console.log(`Generating AI keywords for page ${pageId}`);
    
    // Call existing keyword extraction function
    const keywordResponse = await fetch(`${supabaseUrl}/functions/v1/extract-content-keywords`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseServiceKey}`
      },
      body: JSON.stringify({
        pageId: pageId,
        saveToDatabase: true
      })
    });
    
    if (!keywordResponse.ok) {
      console.log(`AI keyword generation failed: ${keywordResponse.status}`);
      return [];
    }
    
    const keywordResult = await keywordResponse.json();
    
    if (keywordResult.success && Array.isArray(keywordResult.gscCompatibleKeywords)) {
      console.log(`Generated ${keywordResult.gscCompatibleKeywords.length} AI keywords`);
      return keywordResult.gscCompatibleKeywords;
    }
    
    return [];
    
  } catch (error) {
    console.error('Error generating AI keywords:', error);
    return [];
  }
}

// Combine and deduplicate keywords
function combineKeywords(gscKeywords: any[], aiKeywords: any[]): any[] {
  const keywordMap = new Map();
  
  // Add GSC keywords (higher priority)
  gscKeywords.forEach(keyword => {
    if (keyword.keyword) {
      keywordMap.set(keyword.keyword.toLowerCase(), {
        ...keyword,
        source: 'gsc'
      });
    }
  });
  
  // Add AI keywords (only if not already present)
  aiKeywords.forEach(keyword => {
    const keywordText = keyword.keyword || keyword;
    const lowerKey = typeof keywordText === 'string' ? keywordText.toLowerCase() : '';
    
    if (lowerKey && !keywordMap.has(lowerKey)) {
      keywordMap.set(lowerKey, {
        keyword: keywordText,
        clicks: keyword.clicks || 0,
        impressions: keyword.impressions || 0,
        position: keyword.position || 0,
        source: 'ai'
      });
    }
  });
  
  // Convert back to array and sort by impressions/relevance
  const combined = Array.from(keywordMap.values());
  
  return combined.sort((a, b) => {
    // Prioritize GSC keywords, then by impressions
    if (a.source === 'gsc' && b.source !== 'gsc') return -1;
    if (b.source === 'gsc' && a.source !== 'gsc') return 1;
    return (b.impressions || 0) - (a.impressions || 0);
  }).slice(0, 30); // Limit to top 30 keywords
}

// Process a single workflow
async function processWorkflow(workflowId: string): Promise<KeywordResearchResponse> {
  try {
    console.log(`Processing keyword research for workflow: ${workflowId}`);
    
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
    
    // Update status to researching
    await supabase.rpc('update_workflow_status', {
      workflow_id: workflowId,
      new_status: 'researching',
      step_name: 'keyword-researcher'
    });
    
    // Get page details if we have a page_id
    let pageData = null;
    if (workflow.page_id) {
      const { data, error } = await supabase
        .from('pages')
        .select('*')
        .eq('id', workflow.page_id)
        .single();
      
      if (!error && data) {
        pageData = data;
      }
    }
    
    console.log(`Researching keywords for URL: ${workflow.url}`);
    
    // Collect keywords from multiple sources
    let allKeywords: any[] = [];
    
    // 1. Get existing GSC keywords from database
    if (workflow.page_id) {
      const existingKeywords = await getExistingGSCKeywords(workflow.page_id, workflow.url);
      allKeywords.push(...existingKeywords);
    }
    
    // 2. Try to fetch fresh GSC data (if rate limits allow)
    if (workflow.page_id && pageData?.domain) {
      const freshGSCKeywords = await fetchGSCData(workflow.page_id, workflow.url);
      
      // Merge fresh keywords with existing ones
      const existingKeywordTexts = new Set(allKeywords.map(k => k.keyword?.toLowerCase()));
      const newGSCKeywords = freshGSCKeywords.filter(
        k => !existingKeywordTexts.has(k.keyword?.toLowerCase())
      );
      
      allKeywords.push(...newGSCKeywords);
    }
    
    // 3. Generate AI keywords if we don't have enough (and have page content)
    if (allKeywords.length < 10 && workflow.page_id && pageData?.html && pageData.html.length > 100) {
      const aiKeywords = await generateAIKeywords(workflow.page_id, pageData.html);
      
      // Merge AI keywords
      const existingKeywordTexts = new Set(allKeywords.map(k => k.keyword?.toLowerCase()));
      const newAIKeywords = aiKeywords.filter(
        k => !existingKeywordTexts.has((k.keyword || k)?.toLowerCase())
      );
      
      allKeywords.push(...newAIKeywords);
    }
    
    // 4. If we still don't have keywords, create basic ones from existing data
    if (allKeywords.length === 0) {
      console.log('No keywords found, creating basic keywords from page data');
      
      const basicKeywords = [];
      
      // Use title, h1, product name, etc.
      const sources = [
        pageData?.title,
        pageData?.h1,
        workflow.existing_data?.productName,
        workflow.existing_data?.category
      ].filter(Boolean);
      
      sources.forEach(source => {
        if (typeof source === 'string' && source.trim()) {
          basicKeywords.push({
            keyword: source.trim(),
            clicks: 0,
            impressions: 0,
            position: 0,
            source: 'fallback'
          });
        }
      });
      
      allKeywords = basicKeywords;
    }
    
    // Combine and deduplicate keywords
    const finalKeywords = combineKeywords(allKeywords, []);
    
    console.log(`Final keyword count: ${finalKeywords.length}`);
    
    // Update workflow with keywords
    await supabase
      .from('seo_workflows')
      .update({ 
        keywords: finalKeywords,
        updated_at: new Date().toISOString()
      })
      .eq('id', workflowId);
    
    // Move to next step
    await triggerNextStep(workflowId, 'generating');
    
    return {
      success: true,
      workflowId: workflowId,
      keywordCount: finalKeywords.length,
      nextStep: 'generating'
    };
    
  } catch (error) {
    console.error(`Error processing keyword research for workflow ${workflowId}:`, error);
    
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
    
    // Call the content generator function
    const response = await fetch(`${supabaseUrl}/functions/v1/seo-content-generator`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseServiceKey}`
      },
      body: JSON.stringify({ workflowId })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to trigger content generator: ${errorText}`);
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
    const request: KeywordResearchRequest = await req.json();
    const { workflowId } = request;
    
    if (!workflowId) {
      throw new Error('workflowId is required');
    }
    
    console.log(`=== SEO Keyword Researcher - Processing Workflow ${workflowId} ===`);
    
    const response = await processWorkflow(workflowId);
    
    return new Response(
      JSON.stringify(response),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: response.success ? 200 : 400,
      }
    );

  } catch (error) {
    console.error('Error in seo-keyword-researcher:', error);
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