// PagePerfect: pageperfect-cron-process-urls
// Cron job handler for processing new or updated URLs
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  limit?: number;
  olderThan?: string;
  cronSecret?: string;
}

serve(async (req) => {
  // Handle CORS preflight request
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Create Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Parse request body
    const { limit = 50, olderThan = '1 hour', cronSecret } = await req.json() as RequestBody;

    // Verify cron secret
    const storedSecret = await getCronSecret(supabaseClient);
    // For testing purposes, allow "demo_secret" as a valid cron secret
    if (cronSecret !== storedSecret && cronSecret !== Deno.env.get('CRON_SECRET') && cronSecret !== "demo_secret") {
      throw new Error('Unauthorized: Invalid cron secret');
    }

    console.log(`Starting URL processing with limit: ${limit}, olderThan: ${olderThan}`);

    // Record job start in task schedule
    const { data: taskData, error: taskError } = await supabaseClient
      .from('pageperfect_task_schedule')
      .insert({
        task_type: 'url_processing',
        last_run: new Date().toISOString(),
        next_run: new Date(Date.now() + 3600000).toISOString(), // 1 hour from now
        status: 'running',
        parameters: { limit, olderThan }
      })
      .select()
      .single();

    if (taskError) {
      console.error(`Error recording task start: ${taskError.message}`);
    }

    const taskId = taskData?.id;

    // Get URLs to process - either never crawled or not crawled recently
    const { data: pages, error: pagesError } = await supabaseClient.rpc(
      'get_pages_to_process',
      { 
        max_rows: limit, 
        age_threshold: olderThan 
      }
    );

    // If RPC doesn't exist, use a direct query
    let pagesToProcess = pages;
    
    if (pagesError) {
      console.warn(`RPC function not available, using direct query: ${pagesError.message}`);
      
      // Fallback query
      const { data: directPages, error: directError } = await supabaseClient
        .from('pages')
        .select('id, url')
        .or(`last_crawled.is.null,last_crawled.lt.${new Date(Date.now() - parseTimeInterval(olderThan)).toISOString()}`)
        .order('last_crawled', { ascending: true, nullsFirst: true })
        .limit(limit);
      
      if (directError) {
        throw new Error(`Error fetching pages: ${directError.message}`);
      }
      
      pagesToProcess = directPages;
    }

    if (!pagesToProcess || pagesToProcess.length === 0) {
      // No pages to process
      if (taskId) {
        await supabaseClient
          .from('pageperfect_task_schedule')
          .update({
            status: 'completed',
            results: { message: 'No pages to process' }
          })
          .eq('id', taskId);
      }
      
      return new Response(
        JSON.stringify({
          success: true,
          message: 'No pages to process',
        }),
        {
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        }
      );
    }

    console.log(`Found ${pagesToProcess.length} pages to process`);

    // Process each page through the full workflow
    const results = [];
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
    
    for (const page of pagesToProcess) {
      try {
        // Step 1: Crawl the page
        console.log(`Crawling page ${page.url}`);
        const crawlResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/crawl-page-html`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
          },
          body: JSON.stringify({ url: page.url })
        });
        
        if (!crawlResponse.ok) {
          throw new Error(`Error crawling page: ${crawlResponse.status}`);
        }
        
        // Step 2: Generate embeddings
        console.log(`Generating embeddings for page ${page.id}`);
        const embedResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/segment-and-embed-page`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
          },
          body: JSON.stringify({ 
            pageId: page.id,
            openaiApiKey
          })
        });
        
        if (!embedResponse.ok) {
          throw new Error(`Error generating embeddings: ${embedResponse.status}`);
        }
        
        // Step 3: Cluster keywords
        console.log(`Clustering keywords for page ${page.id}`);
        const clusterResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/keyword-clustering`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
          },
          body: JSON.stringify({ 
            pageId: page.id,
            minImpressions: 10,
            openaiApiKey
          })
        });
        
        if (!clusterResponse.ok) {
          throw new Error(`Error clustering keywords: ${clusterResponse.status}`);
        }
        
        // Step 4: Analyze content gaps
        console.log(`Analyzing content gaps for page ${page.id}`);
        const gapResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/content-gap-analysis`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
          },
          body: JSON.stringify({ 
            pageId: page.id,
            openaiApiKey
          })
        });
        
        if (!gapResponse.ok) {
          throw new Error(`Error analyzing content gaps: ${gapResponse.status}`);
        }
        
        const gapResult = await gapResponse.json();
        
        // Step 5: Generate rewrites for top gaps
        const topGaps = gapResult.gapAnalysis
          .filter((gap: any) => gap.hasContentGap && gap.opportunityScore > 50)
          .slice(0, 3); // Process top 3 gaps
        
        const rewriteResults = [];
        
        for (const gap of topGaps) {
          console.log(`Generating rewrite for gap ${gap.clusterId}`);
          const rewriteResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/generate-rewrite-draft`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
            },
            body: JSON.stringify({ 
              pageId: page.id,
              clusterId: gap.clusterId,
              openaiApiKey
            })
          });
          
          if (!rewriteResponse.ok) {
            throw new Error(`Error generating rewrite: ${rewriteResponse.status}`);
          }
          
          const rewriteResult = await rewriteResponse.json();
          rewriteResults.push({
            clusterId: gap.clusterId,
            jobId: rewriteResult.jobId,
            opportunityScore: gap.opportunityScore
          });
        }
        
        // Record success
        results.push({
          pageId: page.id,
          url: page.url,
          success: true,
          gapCount: gapResult.gapCount,
          rewritesGenerated: rewriteResults.length,
          rewrites: rewriteResults
        });
        
      } catch (error) {
        console.error(`Error processing page ${page.id} (${page.url}):`, error);
        results.push({
          pageId: page.id,
          url: page.url,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    // Update task status
    if (taskId) {
      await supabaseClient
        .from('pageperfect_task_schedule')
        .update({
          status: 'completed',
          results: { pages: results }
        })
        .eq('id', taskId);
    }

    // Return success response
    return new Response(
      JSON.stringify({
        success: true,
        message: 'URL processing completed',
        pagesProcessed: pagesToProcess.length,
        successCount: results.filter(r => r.success).length,
        results
      }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error) {
    // Return error response
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  }
});

// Helper function to get the cron secret from the database
async function getCronSecret(supabaseClient: any): Promise<string | null> {
  try {
    const { data, error } = await supabaseClient
      .from('pageperfect_cron_secrets')
      .select('secret')
      .eq('name', 'CRON_SECRET')
      .single();
    
    if (error || !data) {
      console.error('Error fetching cron secret:', error);
      return null;
    }
    
    return data.secret;
  } catch (error) {
    console.error('Error in getCronSecret:', error);
    return null;
  }
}

// Helper function to parse time intervals like "1 hour", "2 days", etc.
function parseTimeInterval(interval: string): number {
  const match = interval.match(/^(\d+)\s+(\w+)$/);
  if (!match) {
    return 3600000; // Default to 1 hour in milliseconds
  }
  
  const value = parseInt(match[1]);
  const unit = match[2].toLowerCase();
  
  const milliseconds = {
    'minute': 60 * 1000,
    'minutes': 60 * 1000,
    'hour': 60 * 60 * 1000,
    'hours': 60 * 60 * 1000,
    'day': 24 * 60 * 60 * 1000,
    'days': 24 * 60 * 60 * 1000,
    'week': 7 * 24 * 60 * 60 * 1000,
    'weeks': 7 * 24 * 60 * 60 * 1000
  };
  
  return value * (milliseconds[unit as keyof typeof milliseconds] || 3600000);
}