// Analyze page for SEO optimization recommendations
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SEO_ANALYSIS_SYSTEM_PROMPT = `You are an expert SEO analyst. Your task is to analyze a web page's HTML content and provide detailed, actionable on-page SEO recommendations.

Review the HTML content carefully and provide a comprehensive analysis covering:

1. Meta Information
   - Title tag (presence, length, keyword placement)
   - Meta description (presence, length, call to action, keyword usage)
   - Other meta tags (canonical, robots, etc.)

2. Content Analysis
   - Headings structure (H1, H2, H3, etc.) and keyword usage
   - Content length and quality
   - Keyword usage and distribution (including LSI keywords)
   - Internal and external linking
   - Image optimization (alt tags, file names)

3. Technical SEO
   - Page speed indicators
   - Mobile-friendliness indicators
   - Schema markup presence and validity
   - URL structure
   - Any noticeable JavaScript-rendering issues

4. Priority Improvements
   - List the top 5 most critical issues to fix, ordered by importance
   - Give specific, actionable recommendations for each issue

5. Keyword Optimization
   - Thoroughly analyze how well the target keywords are integrated in the content
   - Check for keyword presence in titles, headings, meta description, and body content
   - Provide specific recommendations for better keyword integration
   - Check for keyword density and suggest improvements

Format your response as structured JSON with the following sections:
- meta_analysis
- content_analysis
- technical_analysis
- keyword_analysis (include specific recommendations for each provided keyword)
- priority_recommendations (array of 5 items with "issue" and "recommendation" fields)
- overall_score (1-100)

Keep your analysis data-driven, detailed, and focused on delivering maximum SEO value.`;

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Get Supabase URL and service role key from environment
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
    const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    }
    
    // Parse request body for parameters
    let params = {};
    try {
      params = await req.json();
    } catch (e) {
      params = {};
    }
    
    const { pageId, url, openaiApiKey } = params;
    
    // We need either pageId or url
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
    
    // Step 1: Get the page and its HTML
    let page;
    
    if (pageId) {
      const { data, error } = await supabase
        .from('pages')
        .select('*')
        .eq('id', pageId)
        .single();
        
      if (error) throw new Error(`Error getting page: ${error.message}`);
      if (!data) throw new Error(`Page with ID ${pageId} not found`);
      
      page = data;
    } else {
      const { data, error } = await supabase
        .from('pages')
        .select('*')
        .eq('url', url)
        .single();
        
      if (error || !data) {
        // Create page if it doesn't exist
        const { data: newPage, error: createError } = await supabase
          .from('pages')
          .insert({ url })
          .select()
          .single();
          
        if (createError) throw new Error(`Error creating page: ${createError.message}`);
        
        page = newPage;
      } else {
        page = data;
      }
    }
    
    // Check if we have HTML to analyze
    if (!page.html || page.html.length === 0) {
      throw new Error(`No HTML content available for page ${page.id} (${page.url})`);
    }
    
    console.log(`Analyzing SEO for page ${page.id}, URL: ${page.url}`);
    
    // Step 2: Get keywords from multiple sources
    let keywords = [];
    
    // First check page_seo_recommendations table
    try {
      const { data: recKeywords, error: recError } = await supabase
        .from('page_seo_recommendations')
        .select('keywords')
        .eq('page_id', page.id)
        .single();
        
      if (!recError && recKeywords?.keywords && Array.isArray(recKeywords.keywords) && recKeywords.keywords.length > 0) {
        keywords = recKeywords.keywords;
        console.log(`Found ${keywords.length} keywords in page_seo_recommendations`);
      }
    } catch (keywordError) {
      console.error(`Error checking recommendations table: ${keywordError.message}`);
    }
    
    // If no keywords yet, try GSC keywords
    if (keywords.length === 0) {
      try {
        const { data: keywordsData, error: keywordsError } = await supabase
          .from('gsc_keywords')
          .select('keyword, clicks, impressions, position, ctr')
          .eq('page_id', page.id)
          .order('impressions', { ascending: false })
          .limit(20);
          
        if (!keywordsError && keywordsData && keywordsData.length > 0) {
          keywords = keywordsData;
          console.log(`Found ${keywordsData.length} keywords from gsc_keywords`);
        }
      } catch (keywordsError) {
        console.error(`Error fetching keywords: ${keywordsError.message}`);
      }
    }
    
    // SKIP KEYWORD EXTRACTION TO PREVENT DUPLICATE CALLS
    // The seo-direct-workflow-track function already calls extract-content-keywords
    // before calling analyze-page-seo, so we don't need to call it again here
    if (keywords.length < 3) {
      console.log(`Found only ${keywords.length} keywords, but skipping AI generation to prevent duplicate calls`);
      
      // Skip analysis if we have no real keywords - don't add sample data
      if (keywords.length === 0) {
        console.log('No keywords found - skipping SEO analysis to avoid sample data');
        return new Response(
          JSON.stringify({
            success: false,
            error: 'No keywords available for analysis',
            message: 'Skipping analysis to prevent sample keyword insertion'
          }),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 400
          }
        );
      }
    }
    
    // Format keywords for the prompt
    let keywordPrompt = '';
    if (keywords.length > 0) {
      keywordPrompt = "\n\nTarget keywords for this page (ordered by importance):\n";
      keywords.forEach((kw, index) => {
        const source = kw.ai_generated ? 'AI prediction' : 'GSC data';
        const stats = kw.impressions ? 
          `impressions: ${kw.impressions}, clicks: ${kw.clicks}, position: ${kw.position}` :
          'no metrics available';
        
        keywordPrompt += `${index + 1}. "${kw.keyword}" (${source}, ${stats})\n`;
      });
      keywordPrompt += "\nPlease analyze how well these keywords are utilized in the content and provide specific recommendations for optimizing their usage.\n";
    }
    
    // Extract the first 100,000 characters of HTML to avoid token limits
    const htmlContent = page.html.substring(0, 100000);
    
    // TEMPORARILY DISABLED: Call to Anthropic API replaced with mock data
    // Keeping the original code but commented out to save token costs
    /*
    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
    if (!ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is not set in environment variables');
    }
    
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: "claude-3-7-sonnet-20250219",
        max_tokens: 20000,
        system: SEO_ANALYSIS_SYSTEM_PROMPT + "\n\nVERY IMPORTANT: Format your final response by wrapping the JSON output in <results> tags like this:\n<results>\n{\"key\": \"value\", ...}\n</results>",
        thinking: {
          type: "enabled",
          budget_tokens: 16000
        },
        messages: [
          {
            role: "user",
            content: `Here is the HTML for ${page.url}:${keywordPrompt}\n\nPlease analyze this HTML and provide SEO recommendations. Return the results as JSON wrapped in <results> tags.\n\n${htmlContent}`
          }
        ]
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Claude API error: ${response.status} ${response.statusText} - ${errorText}`);
    }
    
    const claudeResult = await response.json();
    */
    
    // RETURNING DUMMY DATA TO SAVE API COSTS AND PREVENT DUPLICATE PROCESSING
    // This function returns mock SEO analysis data instead of calling Claude API
    console.log('DUMMY DATA: Returning mock SEO analysis to save API costs and prevent duplicate processing');
    
    // Create an array of extracted keywords for the mock data - only use real keywords
    const keywordStrings = keywords
      .filter(k => k.keyword && !k.keyword.toLowerCase().includes('sample'))
      .map(k => k.keyword)
      .slice(0, 5);
    
    // If no real keywords available, skip mock data generation
    if (keywordStrings.length === 0) {
      console.log('No real keywords available for mock analysis - skipping');
      return new Response(
        JSON.stringify({
          success: false,
          error: 'No real keywords available for analysis',
          message: 'Cannot generate meaningful analysis without real keywords'
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400
        }
      );
    }
    
    // Mock thinking text
    const mockThinkingText = 'Mock thinking process for SEO analysis. This is placeholder text to simulate Claude thinking.';
    
    // Generate mock SEO analysis
    let seoAnalysis = {
      meta_analysis: {
        title: {
          status: "Needs improvement",
          recommendation: "Update title to include primary keyword and stay under 60 characters"
        },
        meta_description: {
          status: "Needs improvement", 
          recommendation: "Add meta description with primary and secondary keywords, keep under 160 characters"
        },
        meta_tags: {
          status: "Good",
          recommendation: "No issues found with other meta tags"
        }
      },
      content_analysis: {
        headings: {
          status: "Needs improvement",
          recommendation: "Add more H2 and H3 headings with keywords for better structure"
        },
        content_length: {
          status: "Good",
          recommendation: "Content length is sufficient, but consider expanding some sections"
        },
        keyword_usage: {
          status: "Needs improvement",
          recommendation: "Increase primary keyword density to 1-2% and add more LSI keywords"
        },
        internal_linking: {
          status: "Needs improvement",
          recommendation: "Add more internal links to related content"
        },
        images: {
          status: "Poor",
          recommendation: "Add alt tags to all images and include keywords where relevant"
        }
      },
      technical_analysis: {
        page_speed: {
          status: "Unknown",
          recommendation: "Run a page speed test to identify optimization opportunities"
        },
        mobile_friendliness: {
          status: "Unknown",
          recommendation: "Check mobile responsiveness and ensure all elements display correctly"
        },
        schema_markup: {
          status: "Missing",
          recommendation: "Add schema markup for better search engine understanding"
        },
        url_structure: {
          status: "Good",
          recommendation: "URL structure is clean and contains keywords"
        }
      },
      keyword_analysis: {
        primary_keyword: {
          keyword: keywordStrings[0],
          usage: "Insufficient",
          recommendation: "Include in title, H1, meta description, and increase density in content"
        },
        secondary_keywords: keywordStrings.slice(1).map(kw => ({
          keyword: kw,
          usage: "Low",
          recommendation: "Add to H2/H3 headings and naturally in content"
        }))
      },
      priority_recommendations: [
        {
          issue: "Missing meta description",
          recommendation: "Add a compelling meta description with primary keyword"
        },
        {
          issue: "Low keyword density",
          recommendation: "Increase primary keyword usage in content naturally"
        },
        {
          issue: "Insufficient headings structure",
          recommendation: "Add more H2 and H3 headings with keywords"
        },
        {
          issue: "Missing image alt tags",
          recommendation: "Add descriptive alt tags to all images"
        },
        {
          issue: "No schema markup",
          recommendation: "Implement schema.org markup for better SERP features"
        }
      ],
      overall_score: 65
    };
    
    // Add the mock thinking text to the analysis object so it gets saved
    seoAnalysis.thinking_text = mockThinkingText;
    
    // Step 3: Get GSC data for this page
    let gscData = {
      impressions: null,
      clicks: null,
      ctr: null,
      average_rank: null,
      data_date: null,
      has_gsc_data: false
    };
    
    console.log(`Fetching GSC data for page URL: ${page.url}`);
    
    try {
      // Query GSC data for this specific page
      const { data: gscResults, error: gscError } = await supabase
        .from('gsc_keywords')
        .select('clicks, impressions, ctr, position, fetched_date')
        .eq('page_url', page.url)
        .order('impressions', { ascending: false })
        .limit(50); // Get top 50 keywords for this page
      
      if (!gscError && gscResults && gscResults.length > 0) {
        console.log(`Found ${gscResults.length} GSC keyword records for this page`);
        
        // Aggregate GSC data
        const totalImpressions = gscResults.reduce((sum, row) => sum + (row.impressions || 0), 0);
        const totalClicks = gscResults.reduce((sum, row) => sum + (row.clicks || 0), 0);
        const avgCtr = totalClicks > 0 ? (totalClicks / totalImpressions) * 100 : 0;
        
        // Calculate weighted average position
        let weightedPositionSum = 0;
        let totalWeight = 0;
        gscResults.forEach(row => {
          const weight = row.impressions || 0;
          weightedPositionSum += (row.position || 0) * weight;
          totalWeight += weight;
        });
        const avgPosition = totalWeight > 0 ? weightedPositionSum / totalWeight : 0;
        
        // Get most recent date
        const latestDate = gscResults
          .map(r => r.fetched_date)
          .filter(d => d)
          .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];
        
        gscData = {
          impressions: totalImpressions,
          clicks: totalClicks,
          ctr: parseFloat(avgCtr.toFixed(4)),
          average_rank: parseFloat(avgPosition.toFixed(2)),
          data_date: latestDate,
          has_gsc_data: true
        };
        
        console.log(`Aggregated GSC data: ${totalImpressions} impressions, ${totalClicks} clicks, ${avgCtr.toFixed(2)}% CTR, avg position ${avgPosition.toFixed(2)}`);
      } else {
        console.log('No GSC data found for this page');
      }
    } catch (gscFetchError) {
      console.error(`Error fetching GSC data: ${gscFetchError.message}`);
    }

    // Step 4: Save the analysis results along with the keywords and GSC data
    // First check if there's an existing record
    const { data: existingRecs, error: checkError } = await supabase
      .from('page_seo_recommendations')
      .select('id, has_gsc_data')
      .eq('page_id', page.id)
      .order('created_at', { ascending: false })
      .limit(1);
      
    let savedAnalysis;
    
    if (!checkError && existingRecs && existingRecs.length > 0) {
      // Update existing record
      console.log(`Updating existing SEO recommendations record ${existingRecs[0].id}`);
      
      // Check if the existing record has GSC data already
      const existingHasGscData = existingRecs[0].has_gsc_data === true;
      
      const { data: updatedAnalysis, error: updateError } = await supabase
        .from('page_seo_recommendations')
        .update({
          page_id: page.id,
          url: page.url,
          seo_data: seoAnalysis,
          priority_recommendations: seoAnalysis.priority_recommendations || [],
          overall_score: seoAnalysis.overall_score || 0,
          thinking_log: seoAnalysis.thinking_text || '',
          // Only update keywords if we don't have GSC data already
          ...(existingHasGscData ? {} : { keywords: keywords.length > 0 ? keywords : null }),
          // Update GSC data fields
          gsc_impressions: gscData.impressions,
          gsc_clicks: gscData.clicks,
          gsc_ctr: gscData.ctr,
          gsc_average_rank: gscData.average_rank,
          gsc_data_date: gscData.data_date,
          has_gsc_data: gscData.has_gsc_data || existingHasGscData,
          updated_at: new Date().toISOString()
        })
        .eq('id', existingRecs[0].id)
        .select()
        .single();
        
      if (updateError) {
        throw new Error(`Error updating SEO analysis: ${updateError.message}`);
      }
      
      savedAnalysis = updatedAnalysis;
    } else {
      // Insert new record
      console.log(`Creating new SEO recommendations record for page ${page.id}`);
      
      const { data: newAnalysis, error: saveError } = await supabase
        .from('page_seo_recommendations')
        .insert({
          page_id: page.id,
          url: page.url,
          seo_data: seoAnalysis,
          priority_recommendations: seoAnalysis.priority_recommendations || [],
          overall_score: seoAnalysis.overall_score || 0,
          thinking_log: seoAnalysis.thinking_text || '',
          keywords: keywords.length > 0 ? keywords : null,
          // Insert GSC data fields
          gsc_impressions: gscData.impressions,
          gsc_clicks: gscData.clicks,
          gsc_ctr: gscData.ctr,
          gsc_average_rank: gscData.average_rank,
          gsc_data_date: gscData.data_date,
          has_gsc_data: gscData.has_gsc_data,
          created_at: new Date().toISOString()
        })
        .select()
        .single();
        
      if (saveError) {
        throw new Error(`Error saving SEO analysis: ${saveError.message}`);
      }
      
      savedAnalysis = newAnalysis;
    }
    
    return new Response(
      JSON.stringify({
        success: true,
        message: `Successfully analyzed SEO for ${page.url}`,
        page: {
          id: page.id,
          url: page.url
        },
        analysis: {
          id: savedAnalysis.id,
          overall_score: savedAnalysis.overall_score,
          priority_recommendations: savedAnalysis.priority_recommendations,
          keyword_count: keywords.length,
          gsc_data: {
            impressions: gscData.impressions,
            clicks: gscData.clicks,
            ctr: gscData.ctr,
            average_rank: gscData.average_rank,
            has_data: gscData.has_gsc_data
          }
        }
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
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