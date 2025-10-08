// Analyze page for SEO optimization using Kimi K2 via Groq with stripped HTML
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Strip HTML of scripts, styles, and other non-content elements
 */
function stripHtmlForAnalysis(html: string): string {
  // Remove script tags and content
  let cleaned = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  
  // Remove style tags and content
  cleaned = cleaned.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  
  // Remove comments
  cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, '');
  
  // Remove noscript tags
  cleaned = cleaned.replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '');
  
  // Remove base64 data URIs to save space
  cleaned = cleaned.replace(/data:[^;]+;base64,[^"'\s]*/gi, 'data:removed');
  
  // Remove excessive whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  
  return cleaned;
}

/**
 * Extract important SEO elements before stripping
 */
function extractSeoElements(html: string): {
  structuredData: any[];
  metaTags: Record<string, string>;
  canonicalUrl: string | null;
  title: string | null;
} {
  const structuredData = [];
  const metaTags: Record<string, string> = {};
  let canonicalUrl = null;
  let title = null;
  
  // Extract JSON-LD structured data
  const jsonLdMatches = html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const match of jsonLdMatches) {
    try {
      const jsonData = JSON.parse(match[1]);
      structuredData.push(jsonData);
    } catch (e) {
      // Invalid JSON, skip
    }
  }
  
  // Extract meta tags
  const metaMatches = html.matchAll(/<meta\s+([^>]+)>/gi);
  for (const match of metaMatches) {
    const nameMatch = match[1].match(/(?:name|property)=["']([^"']+)["']/);
    const contentMatch = match[1].match(/content=["']([^"']+)["']/);
    if (nameMatch && contentMatch) {
      metaTags[nameMatch[1]] = contentMatch[1];
    }
  }
  
  // Extract canonical URL
  const canonicalMatch = html.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i);
  if (canonicalMatch) {
    canonicalUrl = canonicalMatch[1];
  }
  
  // Extract title
  const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
  if (titleMatch) {
    title = titleMatch[1];
  }
  
  return { structuredData, metaTags, canonicalUrl, title };
}

const SEO_ANALYSIS_PROMPT = `You are an expert SEO analyst. Analyze this webpage's HTML content for SEO effectiveness.

Provide a comprehensive analysis in JSON format with these sections:
{
  "meta_analysis": {
    "title": { "present": boolean, "length": number, "optimized": boolean, "issues": [], "recommendations": [] },
    "meta_description": { "present": boolean, "length": number, "optimized": boolean, "issues": [], "recommendations": [] },
    "other_meta_tags": { "canonical": string, "robots": string, "og_tags": {}, "issues": [] }
  },
  "content_analysis": {
    "headings": { "h1_count": number, "h2_count": number, "structure_quality": string, "keyword_usage": string, "issues": [] },
    "content_length": number,
    "keyword_density": {},
    "internal_links": number,
    "external_links": number,
    "images": { "total": number, "with_alt": number, "issues": [] }
  },
  "technical_analysis": {
    "schema_markup": { "present": boolean, "types": [], "valid": boolean },
    "html_structure": { "semantic_tags": boolean, "issues": [] },
    "url_structure": { "seo_friendly": boolean, "issues": [] }
  },
  "keyword_analysis": {
    "primary_keyword_usage": { "in_title": boolean, "in_h1": boolean, "in_meta": boolean, "in_content": boolean, "density": number },
    "recommendations": []
  },
  "priority_recommendations": [
    { "issue": "string", "impact": "high|medium|low", "recommendation": "string" }
  ],
  "overall_score": number
}

Be specific, actionable, and focus on the most impactful improvements.`;

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Get environment variables
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
    const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY') || '';
    
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    }
    
    if (!GROQ_API_KEY) {
      throw new Error('Missing GROQ_API_KEY');
    }
    
    // Parse request body
    const params = await req.json();
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
    
    // Get the page and its HTML
    let page;
    
    if (pageId) {
      const { data, error } = await supabase
        .from('pages')
        .select('*')
        .eq('id', pageId)
        .single();
        
      if (error) throw new Error(`Error fetching page: ${error.message}`);
      page = data;
    } else {
      // Try to find by URL or create new
      const { data, error } = await supabase
        .from('pages')
        .select('*')
        .eq('url', url)
        .single();
        
      if (error && error.code === 'PGRST116') {
        // Page doesn't exist, create it
        const { data: newPage, error: createError } = await supabase
          .from('pages')
          .insert({ url, html: '' })
          .select()
          .single();
          
        if (createError) throw new Error(`Error creating page: ${createError.message}`);
        page = newPage;
      } else if (error) {
        throw new Error(`Error fetching page: ${error.message}`);
      } else {
        page = data;
      }
    }
    
    // Check if we have HTML to analyze
    if (!page.html || page.html.length === 0) {
      throw new Error(`No HTML content available for page ${page.id} (${page.url})`);
    }
    
    console.log(`Analyzing SEO for page ${page.id}, URL: ${page.url} using Kimi K2 via Groq`);
    
    // Get keywords from various sources
    let keywords = [];
    
    // Check page_seo_recommendations table first
    try {
      const { data: recKeywords, error: recError } = await supabase
        .from('page_seo_recommendations')
        .select('keywords')
        .eq('page_id', page.id)
        .single();
        
      if (!recError && recKeywords?.keywords && Array.isArray(recKeywords.keywords)) {
        keywords = recKeywords.keywords;
        console.log(`Found ${keywords.length} keywords in page_seo_recommendations`);
      }
    } catch (e) {
      // No keywords in recommendations
    }
    
    // If no keywords, try GSC
    if (keywords.length === 0) {
      const { data: gscKeywords, error: gscError } = await supabase
        .from('gsc_keywords')
        .select('keyword, clicks, impressions, position, ctr')
        .eq('page_id', page.id)
        .order('impressions', { ascending: false })
        .limit(20);
        
      if (!gscError && gscKeywords) {
        keywords = gscKeywords;
        console.log(`Found ${gscKeywords.length} keywords from GSC`);
      }
    }
    
    // Extract SEO elements before stripping
    const seoElements = extractSeoElements(page.html);
    
    // Strip HTML for analysis
    const strippedHtml = stripHtmlForAnalysis(page.html);
    const htmlLength = page.html.length;
    const strippedLength = strippedHtml.length;
    const reduction = Math.round(((htmlLength - strippedLength) / htmlLength) * 100);
    
    console.log(`HTML stripped: ${htmlLength} -> ${strippedLength} chars (${reduction}% reduction)`);
    
    // Build analysis prompt
    let analysisPrompt = `Analyze the SEO effectiveness of this webpage:\n\n`;
    analysisPrompt += `URL: ${page.url}\n\n`;
    
    // Limit HTML to prevent token overflow
    analysisPrompt += `HTML CONTENT (cleaned, ${strippedLength} chars):\n${strippedHtml.substring(0, 40000)}\n\n`;
    
    if (seoElements.structuredData.length > 0) {
      analysisPrompt += `STRUCTURED DATA (JSON-LD):\n${JSON.stringify(seoElements.structuredData, null, 2).substring(0, 3000)}\n\n`;
    }
    
    analysisPrompt += `META TAGS:\n${JSON.stringify(seoElements.metaTags, null, 2)}\n\n`;
    
    if (seoElements.canonicalUrl) {
      analysisPrompt += `CANONICAL URL: ${seoElements.canonicalUrl}\n\n`;
    }
    
    if (seoElements.title) {
      analysisPrompt += `PAGE TITLE: ${seoElements.title}\n\n`;
    }
    
    if (keywords.length > 0) {
      analysisPrompt += `TARGET KEYWORDS FOR OPTIMIZATION:\n`;
      keywords.forEach((kw, idx) => {
        const stats = kw.impressions ? 
          `(impressions: ${kw.impressions}, clicks: ${kw.clicks}, position: ${kw.position})` :
          '(no metrics)';
        analysisPrompt += `${idx + 1}. "${kw.keyword}" ${stats}\n`;
      });
      analysisPrompt += '\nAnalyze how well these keywords are integrated and provide specific recommendations.\n';
    }
    
    // Call Groq API with Kimi K2 model
    console.log('Calling Groq API with Kimi K2 model for SEO analysis...');
    
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'moonshotai/kimi-k2-instruct-0905',
        messages: [
          {
            role: 'system',
            content: SEO_ANALYSIS_PROMPT
          },
          {
            role: 'user',
            content: analysisPrompt
          }
        ],
        temperature: 0.3,
        max_tokens: 4000,
        top_p: 1
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Groq API error: ${response.status} - ${errorText}`);
    }
    
    const groqResult = await response.json();
    const analysisText = groqResult.choices[0]?.message?.content;
    
    if (!analysisText) {
      throw new Error('No analysis returned from Groq/Kimi K2');
    }
    
    // Parse JSON from response
    let seoData;
    try {
      // Extract JSON from the response (in case it's wrapped in markdown)
      const jsonMatch = analysisText.match(/```json\n?([\s\S]*?)\n?```/) || 
                       analysisText.match(/({[\s\S]*})/);
      
      if (jsonMatch) {
        seoData = JSON.parse(jsonMatch[1]);
      } else {
        seoData = JSON.parse(analysisText);
      }
    } catch (e) {
      console.error('Failed to parse Kimi response as JSON:', e);
      // Fallback to structured text response
      seoData = {
        meta_analysis: { raw: analysisText },
        content_analysis: {},
        technical_analysis: {},
        keyword_analysis: {},
        priority_recommendations: [],
        overall_score: 70
      };
    }
    
    // Save analysis results
    const updateData = {
      seo_data: seoData,
      priority_recommendations: seoData.priority_recommendations || [],
      overall_score: seoData.overall_score || 70,
      analyzed_with: 'kimi-k2-groq',
      analysis_timestamp: new Date().toISOString(),
      keywords: keywords.length > 0 ? keywords : null
    };
    
    // Update or insert SEO recommendations
    const { data: existingRec } = await supabase
      .from('page_seo_recommendations')
      .select('id')
      .eq('page_id', page.id)
      .single();
    
    if (existingRec) {
      // Update existing record (preserve SEO content fields)
      const { error: updateError } = await supabase
        .from('page_seo_recommendations')
        .update(updateData)
        .eq('page_id', page.id);
        
      if (updateError) {
        console.error('Error updating recommendations:', updateError);
      }
    } else {
      // Insert new record
      const { error: insertError } = await supabase
        .from('page_seo_recommendations')
        .insert({
          page_id: page.id,
          url: page.url,
          ...updateData
        });
        
      if (insertError) {
        console.error('Error inserting recommendations:', insertError);
      }
    }
    
    console.log(`SEO analysis complete for ${page.url}`);
    
    return new Response(
      JSON.stringify({
        success: true,
        page_id: page.id,
        url: page.url,
        seo_score: seoData.overall_score,
        priority_recommendations: seoData.priority_recommendations,
        html_reduction: `${reduction}%`,
        analyzed_with: 'kimi-k2-groq'
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    );
    
  } catch (error) {
    console.error('Error in analyze-page-seo-kimi:', error);
    
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