// PagePerfect: mock-ingest-gsc
// Mock function to simulate GSC data ingestion for testing
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  siteUrl: string;
  startDate: string;
  endDate: string;
  gscCredentials?: string;
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
    const { siteUrl, startDate, endDate, gscCredentials } = await req.json() as RequestBody;

    if (!siteUrl || !startDate || !endDate) {
      throw new Error('siteUrl, startDate, and endDate are required');
    }

    console.log(`Mock GSC data ingestion for ${siteUrl} from ${startDate} to ${endDate}`);

    // Simulate data processing
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Generate random number of rows processed
    const rowsProcessed = Math.floor(Math.random() * 500) + 100;

    // Create a new page in the database for this URL if using Supabase
    try {
      const parsedUrl = new URL(siteUrl);
      const domain = parsedUrl.hostname;

      // Check if we have a valid Supabase connection and the table exists
      const { data: tableExists } = await supabaseClient.rpc(
        'check_if_table_exists', 
        { table_name: 'pages' }
      ).catch(() => ({ data: false }));

      if (tableExists) {
        // Try to insert the page
        await supabaseClient
          .from('pages')
          .upsert({
            url: siteUrl,
            domain: domain,
            last_crawled: null,
            created_at: new Date().toISOString()
          }, {
            onConflict: 'url'
          });
        
        console.log(`Added page for ${siteUrl} to database`);
      } else {
        console.log('Pages table does not exist, skipping database insertion');
      }
    } catch (err) {
      // Ignore database errors in mock function
      console.log('Could not insert into database (expected in testing)');
    }

    // Return success response
    return new Response(
      JSON.stringify({
        success: true,
        message: 'Mock GSC data ingestion completed successfully',
        rowsProcessed,
        date: startDate,
        siteUrl
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