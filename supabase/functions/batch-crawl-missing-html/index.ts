// Batch crawl pages that are missing HTML content
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  batchSize?: number;
  maxConcurrency?: number;
  domain?: string;
  skipDomains?: string[];
  dryRun?: boolean;
  turboMode?: boolean;
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

    // Parse request
    const { 
      batchSize = 500, 
      maxConcurrency = 20,
      domain,
      skipDomains = [],
      dryRun = false,
      turboMode = false
    } = await req.json() as RequestBody;

    // Turbo mode uses maximum available concurrency
    const actualConcurrency = turboMode ? 100 : maxConcurrency;
    const actualBatchSize = turboMode ? Math.max(batchSize, 2000) : batchSize;

    console.log(`Starting batch crawl - batchSize: ${actualBatchSize}, concurrency: ${actualConcurrency}, turboMode: ${turboMode}, dryRun: ${dryRun}`);

    // Build query for pages without HTML
    let query = supabaseClient
      .from('pages')
      .select('id, url, domain')
      .or('html.is.null,html.eq.')
      .order('created_at', { ascending: false })
      .limit(actualBatchSize);

    // Add domain filter if specified
    if (domain) {
      query = query.eq('domain', domain);
      console.log(`Filtering to domain: ${domain}`);
    }

    // Get pages without HTML
    const { data: pagesWithoutHtml, error: queryError } = await query;

    if (queryError) {
      throw new Error(`Error fetching pages: ${queryError.message}`);
    }

    if (!pagesWithoutHtml || pagesWithoutHtml.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'No pages found without HTML content',
          stats: {
            found: 0,
            processed: 0,
            successful: 0,
            failed: 0
          }
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // Filter out skip domains
    const filteredPages = pagesWithoutHtml.filter(page => {
      if (skipDomains.length > 0 && page.domain && skipDomains.includes(page.domain)) {
        console.log(`Skipping page from domain: ${page.domain}`);
        return false;
      }
      return true;
    });

    console.log(`Found ${pagesWithoutHtml.length} pages without HTML, ${filteredPages.length} after filtering`);

    if (dryRun) {
      // Just return what would be processed
      const domainStats = filteredPages.reduce((acc, page) => {
        const domain = page.domain || 'unknown';
        acc[domain] = (acc[domain] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Dry run completed',
          dryRun: true,
          stats: {
            found: pagesWithoutHtml.length,
            would_process: filteredPages.length,
            domains: domainStats
          },
          sample_urls: filteredPages.slice(0, 10).map(p => p.url)
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // Process pages in parallel batches
    const results = {
      processed: 0,
      successful: 0,
      failed: 0,
      errors: [] as Array<{url: string, error: string}>
    };

    // Process in chunks to avoid overwhelming the system
    const chunks = [];
    for (let i = 0; i < filteredPages.length; i += actualConcurrency) {
      chunks.push(filteredPages.slice(i, i + actualConcurrency));
    }

    console.log(`Processing ${filteredPages.length} pages in ${chunks.length} chunks of max ${actualConcurrency}`);

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunk = chunks[chunkIndex];
      console.log(`Processing chunk ${chunkIndex + 1}/${chunks.length} with ${chunk.length} pages`);

      // Process chunk in parallel
      const chunkPromises = chunk.map(async (page) => {
        try {
          console.log(`Crawling: ${page.url}`);

          const crawlResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/crawl-page-html`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
            },
            body: JSON.stringify({ url: page.url })
          });

          if (!crawlResponse.ok) {
            const errorText = await crawlResponse.text();
            throw new Error(`HTTP ${crawlResponse.status}: ${errorText}`);
          }

          const result = await crawlResponse.json();
          
          if (result.success) {
            results.successful++;
            console.log(`✅ Successfully crawled: ${page.url} (${result.contentLength} chars)`);
          } else {
            results.failed++;
            results.errors.push({
              url: page.url,
              error: result.error || 'Unknown error'
            });
            console.log(`❌ Failed to crawl: ${page.url} - ${result.error}`);
          }

        } catch (error) {
          results.failed++;
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          results.errors.push({
            url: page.url,
            error: errorMessage
          });
          console.log(`❌ Error crawling ${page.url}: ${errorMessage}`);
        }

        results.processed++;
      });

      // Wait for chunk to complete
      await Promise.all(chunkPromises);

      // Add delay between chunks - shorter delay in turbo mode
      if (chunkIndex < chunks.length - 1) {
        const delay = turboMode ? 500 : 2000; // 0.5s in turbo mode, 2s normal
        console.log(`Waiting ${delay}ms before next chunk...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    const successRate = ((results.successful / results.processed) * 100).toFixed(2);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Batch crawl completed: ${results.successful}/${results.processed} successful (${successRate}%)`,
        stats: {
          found: pagesWithoutHtml.length,
          processed: results.processed,
          successful: results.successful,
          failed: results.failed,
          successRate: `${successRate}%`
        },
        errors: results.errors.slice(0, 10), // Return first 10 errors
        totalErrors: results.errors.length
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('Batch crawl error:', error);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});