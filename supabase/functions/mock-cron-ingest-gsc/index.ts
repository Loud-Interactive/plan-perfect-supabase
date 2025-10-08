// PagePerfect: mock-cron-ingest-gsc
// Mock cron job handler for GSC data ingestion
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  date?: string;
  cronSecret?: string;
  gscCredentials?: string;
  siteUrl?: string;
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
    const { date, cronSecret, gscCredentials, siteUrl } = await req.json() as RequestBody;

    // Minimal secret verification for demo
    if (cronSecret !== 'demo_secret' && cronSecret !== Deno.env.get('CRON_SECRET')) {
      throw new Error('Unauthorized: Invalid cron secret');
    }

    // If no date is provided, use yesterday
    const targetDate = date || 
      new Date(Date.now() - 86400000).toISOString().split('T')[0]; // Yesterday

    console.log(`Starting mock GSC data ingestion for date: ${targetDate}`);

    // Define domains to process
    let targetSites = [];
    
    if (siteUrl) {
      // Use provided siteUrl
      console.log(`Using provided site URL: ${siteUrl}`);
      try {
        const url = new URL(siteUrl);
        targetSites = [{ domain: url.hostname, url: siteUrl }];
      } catch (e) {
        // If not a valid URL, use as domain
        targetSites = [{ domain: siteUrl, url: `https://${siteUrl}` }];
      }
    } else {
      // Use some sample domains
      targetSites = [
        { domain: 'example.com', url: 'https://example.com' },
        { domain: 'demo-site.com', url: 'https://demo-site.com' },
        { domain: 'test-blog.com', url: 'https://test-blog.com' }
      ];
    }

    // Process each domain
    const results = [];
    
    for (const site of targetSites) {
      try {
        // Call the mock-ingest-gsc function
        const response = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/mock-ingest-gsc`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || supabaseClient.auth.session()?.access_token}`
          },
          body: JSON.stringify({
            siteUrl: site.url,
            startDate: targetDate,
            endDate: targetDate,
            gscCredentials
          })
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Error in mock GSC ingest: ${response.status} ${errorText}`);
        }
        
        const result = await response.json();
        results.push({
          domain: site.domain,
          rowsProcessed: result.rowsProcessed,
          success: true
        });
        
        console.log(`Processed ${result.rowsProcessed} rows for ${site.domain}`);
      } catch (error) {
        console.error(`Error processing domain ${site.domain}:`, error);
        results.push({
          domain: site.domain,
          error: error instanceof Error ? error.message : 'Unknown error',
          success: false
        });
      }
    }

    // Return success response
    return new Response(
      JSON.stringify({
        success: true,
        message: 'GSC data ingestion completed',
        date: targetDate,
        domainsProcessed: results.length,
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