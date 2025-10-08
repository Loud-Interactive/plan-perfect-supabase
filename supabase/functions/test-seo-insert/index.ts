// Test direct insertion of SEO elements
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Create Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get a valid page ID from the database
    const { data: page, error: pageError } = await supabaseClient
      .from('pages')
      .select('id, url')
      .limit(1)
      .single();

    if (pageError) {
      throw new Error(`Error getting page: ${pageError.message}`);
    }

    if (!page) {
      throw new Error('No pages found in the database');
    }

    console.log(`Got page ID: ${page.id}, URL: ${page.url}`);

    // Directly insert test SEO elements
    const { data: result, error: insertError } = await supabaseClient
      .from('page_seo_recommendations')
      .upsert({
        page_id: page.id,
        url: page.url,
        title: `Test Title for ${page.url}`,
        meta_description: `This is a test meta description for ${page.url}. It contains relevant keywords and is designed to improve click-through rates.`,
        h1: `Test H1 Heading for ${page.url}`,
        h2: 'Test H2 Subheading with Keywords',
        paragraph: 'This is a test paragraph with relevant keywords. It provides valuable information for users and helps with SEO by including natural keyword placement and addressing user intent.',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select();

    if (insertError) {
      throw new Error(`Error inserting SEO elements: ${insertError.message}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Successfully inserted test SEO elements',
        page,
        result
      }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      }
    );
  } catch (error) {
    console.error(`Error: ${error.message}`);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    );
  }
});