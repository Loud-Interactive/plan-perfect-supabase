// PagePerfect: submit-crawl-job
// Function to submit a crawl job for async processing
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  url: string;
  pageId?: string;
  premium?: boolean;
  ultraPremium?: boolean;
  render?: boolean;
}

serve(async (req) => {
  // Handle CORS preflight requests
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
    const { url, pageId, premium = false, ultraPremium = true, render = true } = await req.json() as RequestBody;

    if (!url) {
      throw new Error('URL is required');
    }

    console.log(`Submitting crawl job for URL: ${url}`);

    // Find or create a page for this URL if pageId not provided
    let actualPageId = pageId;
    
    if (!actualPageId) {
      // Check if page already exists
      const { data: existingPage } = await supabaseClient
        .from('pages')
        .select('id')
        .eq('url', url)
        .maybeSingle();
      
      if (existingPage) {
        actualPageId = existingPage.id;
      } else {
        // Create a new page
        const { data: newPage, error } = await supabaseClient
          .from('pages')
          .insert({ url })
          .select('id')
          .single();
          
        if (error) {
          throw new Error(`Failed to create page: ${error.message}`);
        }
        
        actualPageId = newPage.id;
      }
    }

    // Create a new crawl job
    const { data: job, error } = await supabaseClient
      .from('crawl_jobs')
      .insert({
        url,
        page_id: actualPageId,
        status: 'pending',
        premium,
        ultra_premium: ultraPremium,
        render,
      })
      .select()
      .single();
      
    if (error) {
      throw new Error(`Failed to create crawl job: ${error.message}`);
    }
    
    // Return success response
    return new Response(
      JSON.stringify({
        success: true,
        message: 'Crawl job submitted successfully',
        jobId: job.id,
        pageId: actualPageId,
        url
      }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error) {
    console.error(`Error: ${error.message}`);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    );
  }
});