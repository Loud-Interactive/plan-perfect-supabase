// Fast SEO workflow - skips slow keyword extraction
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
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
    const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    }
    
    let params = {};
    try {
      params = await req.json();
    } catch (e) {
      params = {};
    }
    
    const { pageId, url } = params;
    
    if (!pageId && !url) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Either pageId or url is required'
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400
        }
      );
    }
    
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    
    // Get the page
    let page;
    if (pageId) {
      const { data, error } = await supabase
        .from('pages')
        .select('*')
        .eq('id', pageId)
        .single();
        
      if (error) throw new Error(`Error getting page: ${error.message}`);
      page = data;
    } else {
      const { data, error } = await supabase
        .from('pages')
        .select('*')
        .eq('url', url)
        .single();
        
      if (error) throw new Error(`Error getting page: ${error.message}`);
      page = data;
    }
    
    console.log(`Fast SEO workflow for page ${page.id}: ${page.url}`);
    
    // Check if we already have complete SEO recommendations
    const { data: existingSeo, error: seoCheckError } = await supabase
      .from('page_seo_recommendations')
      .select('id, title, h1, meta_description')
      .eq('page_id', page.id)
      .single();
      
    if (!seoCheckError && existingSeo && existingSeo.title && existingSeo.h1 && existingSeo.meta_description) {
      console.log(`Page ${page.id} already has complete SEO recommendations, skipping`);
      
      return new Response(
        JSON.stringify({
          success: true,
          message: `Page ${page.url} already has complete SEO recommendations`,
          page: { id: page.id, url: page.url },
          seo_analysis_id: existingSeo.id,
          already_processed: true
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // SKIP KEYWORD EXTRACTION - just generate SEO elements directly
    console.log(`Generating SEO elements for ${page.url} (fast mode - no keyword extraction)`);
    
    // Extract domain and path for SEO elements
    const urlObj = new URL(page.url);
    const domain = urlObj.hostname.replace('www.', '');
    const pathParts = urlObj.pathname.split('/').filter(p => p);
    const lastPath = pathParts[pathParts.length - 1] || '';
    const path = pathParts.join(' ').replace(/-/g, ' ');
    
    // Generate SEO elements based on URL structure
    const title = path ? 
      `${path.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')} | ${domain}` :
      `Products | ${domain}`;
      
    const h1 = path ?
      path.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') :
      'Products';
      
    const h2 = lastPath ?
      `Explore Our ${lastPath.replace(/-/g, ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')} Collection` :
      'Explore Our Collection';
      
    const metaDescription = path ?
      `Discover ${path} at ${domain}. Quality products with competitive pricing and excellent customer service.` :
      `Shop quality products at ${domain}. Find everything you need with competitive pricing and excellent service.`;
      
    const paragraph = path ?
      `Browse our selection of ${path} designed to meet your needs. We offer quality items at competitive prices, with options for every preference and budget.` :
      `Browse our product selection designed to meet your needs. Quality items at competitive prices with excellent customer service.`;
    
    // Insert/update SEO recommendations
    const { data: seoResult, error: insertError } = await supabase
      .from('page_seo_recommendations')
      .upsert({
        page_id: page.id,
        url: page.url,
        title: title,
        meta_description: metaDescription,
        h1: h1,
        h2: h2,
        paragraph: paragraph,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'page_id'
      })
      .select()
      .single();
      
    if (insertError) {
      throw new Error(`Error saving SEO recommendations: ${insertError.message}`);
    }
    
    console.log(`Successfully generated fast SEO elements for ${page.url}`);
    
    return new Response(
      JSON.stringify({
        success: true,
        message: `Successfully generated fast SEO elements for ${page.url}`,
        page: { id: page.id, url: page.url },
        seo_analysis_id: seoResult.id,
        fast_mode: true
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    console.error(`Fast SEO workflow error: ${error.message}`);
    
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