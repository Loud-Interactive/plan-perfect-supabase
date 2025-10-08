// PagePerfect: pageperfect-cron-ingest-gsc
// Cron job handler for daily GSC data ingestion
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

    // Verify cron secret
    const storedSecret = await getCronSecret(supabaseClient);
    // For testing purposes, allow "demo_secret" as a valid cron secret
    if (cronSecret !== storedSecret && cronSecret !== Deno.env.get('CRON_SECRET') && cronSecret !== "demo_secret") {
      throw new Error('Unauthorized: Invalid cron secret');
    }

    // If no date is provided, use yesterday
    const targetDate = date || 
      new Date(Date.now() - 86400000).toISOString().split('T')[0]; // Yesterday

    console.log(`Starting GSC data ingestion for date: ${targetDate}`);

    // Record job start in task schedule
    const { data: taskData, error: taskError } = await supabaseClient
      .from('pageperfect_task_schedule')
      .insert({
        task_type: 'gsc_ingest',
        last_run: new Date().toISOString(),
        next_run: new Date(Date.now() + 86400000).toISOString(), // Tomorrow
        status: 'running',
        parameters: { date: targetDate, siteUrl }
      })
      .select()
      .single();

    if (taskError) {
      console.error(`Error recording task start: ${taskError.message}`);
    }

    const taskId = taskData?.id;

    // If a siteUrl is provided, use it directly
    let domains = [];
    let targetSites = [];

    if (siteUrl) {
      console.log(`Using provided site URL: ${siteUrl}`);
      
      // Handle domain property format (sc-domain:example.com)
      if (siteUrl.startsWith('sc-domain:')) {
        targetSites = [{ domain: siteUrl, isDomainProperty: true }];
      } else {
        // For regular URLs, extract the hostname
        try {
          targetSites = [{ domain: new URL(siteUrl).hostname, isDomainProperty: false }];
        } catch (error) {
          console.error(`Error parsing URL: ${siteUrl}`, error);
          // In case of failure, use the raw siteUrl
          targetSites = [{ domain: siteUrl, isDomainProperty: true }];
        }
      }
    } else {
      // Otherwise get domains from database
      const { data, error: domainsError } = await supabaseClient
        .from('pages')
        .select('domain')
        .order('domain')
        .is('last_crawled', null)
        .limit(10); // Process top domains first

      if (domainsError) {
        throw new Error(`Error fetching domains: ${domainsError.message}`);
      }
      
      domains = data || [];
      targetSites = domains.map(d => ({ domain: d.domain, isDomainProperty: false }));
    }

    // Get GSC credentials
    let credentialsJson;
    if (gscCredentials) {
      console.log("Using provided GSC credentials");
      credentialsJson = gscCredentials;
    } else {
      credentialsJson = Deno.env.get('GSC_CREDENTIALS');
      if (!credentialsJson) {
        throw new Error('GSC credentials not found in environment or request');
      }
    }

    // Process each domain
    const results = [];
    
    for (const domainObj of targetSites) {
      const domain = domainObj.domain;
      if (!domain) continue;
      
      try {
        // Determine the appropriate site URL format
        let targetSiteUrl;
        
        if (domainObj.isDomainProperty) {
          // If it's already in domain property format, use as is
          targetSiteUrl = domain;
        } else if (siteUrl) {
          // If a specific siteUrl was provided, use it
          targetSiteUrl = siteUrl;
        } else {
          // Otherwise construct an https URL
          targetSiteUrl = `https://${domain}`;
        }
        
        console.log(`Using site URL for GSC API: ${targetSiteUrl}`);
        
        // Call the ingest-gsc function for this domain
        const response = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/ingest-gsc`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
          },
          body: JSON.stringify({
            siteUrl: targetSiteUrl,
            startDate: targetDate,
            endDate: targetDate,
            gscCredentials: credentialsJson
          })
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Error fetching GSC data for ${domain}: ${response.status} ${errorText}`);
        }
        
        const result = await response.json();
        results.push({
          domain,
          rowsProcessed: result.rowsProcessed,
          success: result.success
        });
        
        console.log(`Processed ${result.rowsProcessed} rows for ${domain}`);
      } catch (error) {
        console.error(`Error processing domain ${domain}:`, error);
        results.push({
          domain,
          error: error instanceof Error ? error.message : 'Unknown error',
          success: false
        });
      }
    }

    // Update task status
    if (taskId) {
      await supabaseClient
        .from('pageperfect_task_schedule')
        .update({
          status: 'completed',
          results: { domains: results }
        })
        .eq('id', taskId);
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