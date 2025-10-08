// Extract-content-keywords
// Analyzes page content to suggest SEO keywords when GSC data isn't available
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import OpenAI from "https://deno.land/x/openai@v4.24.0/mod.ts";
import { callDeepSeekWithLogging } from '../utils/model-logging.ts';
import { cleanText, decodeHtmlEntities } from '../_shared/encoding-utils.ts';

const FUNCTION_NAME = 'extract-content-keywords';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};


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
    
    const { pageId, url, htmlContent, saveToDatabase = true } = params;
    
    // We need at least one of: pageId, url, or htmlContent
    if (!pageId && !url && !htmlContent) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Either pageId, url, or htmlContent is required'
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400
        }
      );
    }
    
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    
    // Step 1: Get the page content
    let page;
    let content = htmlContent;
    let domain = '';
    
    if (pageId) {
      // Get existing page by ID
      const { data, error } = await supabase
        .from('pages')
        .select('*')
        .eq('id', pageId)
        .single();
        
      if (error) throw new Error(`Error getting page: ${error.message}`);
      if (!data) throw new Error(`Page with ID ${pageId} not found`);
      
      page = data;
      content = page.html;
      domain = extractDomain(page.url);
    } else if (url && !content) {
      // Try to find the page by URL
      const { data: existingPage, error: existingError } = await supabase
        .from('pages')
        .select('*')
        .eq('url', url)
        .single();
        
      if (!existingError && existingPage) {
        page = existingPage;
        content = page.html;
        domain = extractDomain(url);
      } else {
        // Fetch page content using crawl-page-html
        const response = await fetch(`${SUPABASE_URL}/functions/v1/crawl-page-html`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SUPABASE_KEY}`
          },
          body: JSON.stringify({ url })
        });
        
        if (!response.ok) {
          throw new Error(`Error fetching page content: ${response.status} ${response.statusText}`);
        }
        
        const htmlResult = await response.json();
        
        if (!htmlResult.success) {
          throw new Error(`Error crawling URL: ${htmlResult.error || 'Unknown error'}`);
        }
        
        content = htmlResult.html;
        domain = extractDomain(url);
        
        // Optionally create a page entry
        if (saveToDatabase) {
          const { data: newPage, error: createError } = await supabase
            .from('pages')
            .insert({ url, html: content, html_length: content.length })
            .select()
            .single();
            
          if (createError) {
            console.error(`Error creating page: ${createError.message}`);
          } else {
            page = newPage;
          }
        }
      }
    } else if (url) {
      domain = extractDomain(url);
    }
    
    // Check if we have content to analyze
    if (!content || content.length === 0) {
      throw new Error('No content available to analyze');
    }
    
    console.log(`Analyzing content for keywords: ${page?.url || url || 'provided HTML'}`);
    
    // Convert HTML to Markdown for better analysis
    const markdown = htmlToMarkdown(content);
    
    // Step 2: Use DeepSeek to analyze the content and extract keywords
    // Get the DeepSeek API key from environment or request
    const deepseekApiKey = Deno.env.get('DEEPSEEK_API_KEY');
    if (!deepseekApiKey) {
      throw new Error('DEEPSEEK_API_KEY is not set');
    }
    
    // Set the model name - use deepseek-reasoner or other supported models
    const modelName = 'deepseek-reasoner';
    const apiUrl = 'https://api.deepseek.com/chat/completions';
    
    console.log(`Analyzing content with DeepSeek ${modelName}`);
    
    const KEYWORD_EXTRACTION_SYSTEM_PROMPT = `You are an SEO keyword extraction specialist. Your task is to analyze content and identify the most relevant keywords for SEO optimization.

Analyze the provided HTML/markdown content and extract:

1. Primary keywords (2-3): The most important topics that the content focuses on.
2. Secondary keywords (3-5): Supporting topics and important subtopics.
3. Long-tail keywords (5-8): Specific phrases that are less competitive but highly relevant.
4. Related terms (5-10): Semantically related words to include for better topic coverage.

For each keyword:
- Assess its relevance to the content (0-10)
- Estimate search intent (informational, transactional, navigational)
- Provide a brief explanation for why it's relevant
- Estimate rough search volume (very high, high, medium, low, very low)
- Estimate competition level (high, medium, low)

Your response should be in structured JSON format:
<keywords>
{
  "primary_keywords": [
    {
      "keyword": "example keyword",
      "relevance": 9,
      "search_intent": "informational",
      "explanation": "Core topic of the article, mentioned in title and throughout content",
      "estimated_volume": "medium",
      "competition": "high"
    }
  ],
  "secondary_keywords": [...],
  "long_tail_keywords": [...],
  "related_terms": [...]
}
</keywords>
Ensure your keywords are:
- Actually present in or highly relevant to the content
- Diverse enough to cover the full topic
- Properly categorized by importance

Your analysis should focus on finding valuable SEO opportunities that align with the content's actual topic and purpose.

Here is the content to analyze:
<content>
${markdown}
</content>
`;


    // Build the prompt for keyword extraction
    const prompt = KEYWORD_EXTRACTION_SYSTEM_PROMPT; //`Please analyze this content and extract relevant keywords for SEO optimization:\n\n${markdown.substring(0, 100000)}`;
    
    // Call DeepSeek with logging
    const { response: cleanResponse, thinking } = await callDeepSeekWithLogging(
      FUNCTION_NAME,
      prompt,
      deepseekApiKey,
      domain,
      { 
        url: page?.url || url || 'html-content',
        pageId: page?.id || null,
        modelName
      }
    );
    
    let keywordData;
    
    try {
      // Strategy 1: Try to extract content from <keywords> XML tags
      const keywordsMatch = cleanResponse.match(/<keywords>([\s\S]*?)<\/keywords>/);
      let jsonText = '';
      let parseStrategy = '';
      
      if (keywordsMatch) {
        jsonText = keywordsMatch[1].trim();
        parseStrategy = 'XML tags';
        console.log('Extracted keywords from XML tags');
      } else {
        // Strategy 2: Try to parse the entire response as JSON (for cases without XML tags)
        try {
          keywordData = JSON.parse(cleanResponse);
          console.log('Successfully parsed entire response as JSON');
          parseStrategy = 'direct JSON';
        } catch (directJsonError) {
          // Strategy 3: Fall back to trying to find JSON pattern in the response
          const jsonMatch = cleanResponse.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            jsonText = jsonMatch[0];
            parseStrategy = 'JSON pattern match';
            console.log('Found JSON pattern in response');
          } else {
            throw new Error('No keywords XML tags, direct JSON, or JSON pattern found in response');
          }
        }
      }
      
      // If we have jsonText to parse (from XML tags or pattern match), try to parse it
      if (jsonText && !keywordData) {
        try {
          keywordData = JSON.parse(jsonText);
          console.log(`Successfully parsed keywords as JSON using ${parseStrategy}`);
        } catch (jsonError) {
          console.error('JSON parsing error:', jsonError);
          console.error('Attempted to parse:', jsonText.substring(0, 500));
          throw new Error(`Failed to parse keywords JSON using ${parseStrategy}`);
        }
      }
    } catch (e) {
      console.error('Error parsing DeepSeek response:', e);
      throw new Error(`Failed to extract keywords: ${e.message}`);
    }
    
    // Step 3: Convert keyword data to the same format as GSC keywords
    const gscCompatibleKeywords = convertToGscFormat(keywordData);
    
    // Step 4: Save the results to the database if requested
    if (saveToDatabase && page?.id) {
      console.log(`Saving keyword data for page ${page.id}`);
      
      // Check if there's an existing record
      const { data: existingRec, error: checkError } = await supabase
        .from('page_seo_recommendations')
        .select('id, keywords')
        .eq('page_id', page.id)
        .limit(1);
        
      if (checkError) {
        console.error(`Error checking for existing record: ${checkError.message}`);
      }
      
      if (existingRec && existingRec.length > 0) {
        // Update existing record
        console.log(`Updating existing record ${existingRec[0].id}`);
        
        const { error: updateError } = await supabase
          .from('page_seo_recommendations')
          .update({
            keywords: gscCompatibleKeywords,
            updated_at: new Date().toISOString()
          })
          .eq('id', existingRec[0].id);
          
        if (updateError) {
          console.error(`Error updating record: ${updateError.message}`);
        }
      } else {
        // Insert new record
        console.log(`Creating new record for page ${page.id}`);
        
        const { error: insertError } = await supabase
          .from('page_seo_recommendations')
          .insert({
            page_id: page.id,
            url: page.url,
            keywords: gscCompatibleKeywords,
            thinking_log: thinking || '',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          });
          
        if (insertError) {
          console.error(`Error inserting record: ${insertError.message}`);
        }
      }
    }
    
    // Return success response
    return new Response(
      JSON.stringify({
        success: true,
        url: page?.url || url || 'provided HTML',
        pageId: page?.id,
        keywordData,
        gscCompatibleKeywords,
        thinking: thinking ? thinking : null,
        model: 'deepseek-reasoner'
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
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  }
});

// Extract domain from URL
function extractDomain(url: string): string {
  try {
    if (!url) return '';
    // Add protocol if missing
    const urlWithProtocol = url.startsWith('http') ? url : `https://${url}`;
    const parsed = new URL(urlWithProtocol);
    return parsed.hostname.replace('www.', '');
  } catch (e) {
    console.error(`Error extracting domain from ${url}:`, e);
    return '';
  }
}

// Function to convert HTML to Markdown
function htmlToMarkdown(html: string): string {
  // First clean the HTML content to fix encoding issues
  let markdown = cleanText(html)
    // Remove scripts and styles
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    
    // Convert headings
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '# $1\n\n')
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '## $1\n\n')
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '### $1\n\n')
    .replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '#### $1\n\n')
    .replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, '##### $1\n\n')
    .replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, '###### $1\n\n')
    
    // Convert paragraphs and line breaks
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    
    // Convert lists
    .replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, '$1\n')
    .replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, '$1\n')
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n')
    
    // Convert links
    .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
    
    // Remove all other HTML tags
    .replace(/<[^>]*>/g, '')
    
    // Fix multiple consecutive line breaks
    .replace(/\n\s*\n\s*\n/g, '\n\n');
    
  // HTML entities are already decoded by cleanText, but decode any remaining ones
  markdown = decodeHtmlEntities(markdown);
  
  // Truncate if too long (keep under 100K characters)
  if (markdown.length > 100000) {
    markdown = markdown.substring(0, 100000) + "\n\n[Content truncated due to length...]";
  }
  
  return markdown;
}

// Function to convert Claude's keyword data to GSC-compatible format
function convertToGscFormat(keywordData: any): any[] {
  const gscCompatibleKeywords = [];
  
  // Helper function to add keywords with appropriate format
  function addKeywordsFromCategory(category: string, importance: number) {
    if (!keywordData[category] || !Array.isArray(keywordData[category])) {
      return;
    }
    
    keywordData[category].forEach((item: any, index: number) => {
      if (!item.keyword) return;
      
      // Determine estimated values based on Claude's assessment
      // These are approximations to match GSC data format
      const estimatedImpressions = getEstimatedImpressions(item.estimated_volume);
      const estimatedClicks = Math.round(estimatedImpressions * (Math.min(item.relevance, 10) / 100));
      const estimatedPosition = getEstimatedPosition(item.competition);
      const estimatedCtr = estimatedImpressions > 0 ? (estimatedClicks / estimatedImpressions) : 0;
      
      gscCompatibleKeywords.push({
        keyword: item.keyword,
        impressions: estimatedImpressions,
        clicks: estimatedClicks,
        position: estimatedPosition,
        ctr: estimatedCtr,
        
        // Additional metadata not in GSC but useful for our analysis
        importance: importance,
        relevance: item.relevance,
        search_intent: item.search_intent,
        explanation: item.explanation,
        estimated_volume: item.estimated_volume,
        competition: item.competition,
        ai_generated: true,
        category
      });
    });
  }
  
  // Add keywords from each category with decreasing importance values
  addKeywordsFromCategory('primary_keywords', 10);
  addKeywordsFromCategory('secondary_keywords', 7);
  addKeywordsFromCategory('long_tail_keywords', 5);
  addKeywordsFromCategory('related_terms', 3);
  
  return gscCompatibleKeywords;
}

// Helper functions to estimate GSC metrics
function getEstimatedImpressions(volume: string): number {
  switch (volume?.toLowerCase()) {
    case 'very high': return Math.floor(Math.random() * 5000) + 5000;
    case 'high': return Math.floor(Math.random() * 3000) + 2000;
    case 'medium': return Math.floor(Math.random() * 1500) + 500;
    case 'low': return Math.floor(Math.random() * 400) + 100;
    case 'very low': return Math.floor(Math.random() * 90) + 10;
    default: return Math.floor(Math.random() * 500) + 100;
  }
}

function getEstimatedPosition(competition: string): number {
  switch (competition?.toLowerCase()) {
    case 'high': return parseFloat((Math.random() * 5 + 15).toFixed(1));
    case 'medium': return parseFloat((Math.random() * 10 + 5).toFixed(1));
    case 'low': return parseFloat((Math.random() * 4 + 1).toFixed(1));
    default: return parseFloat((Math.random() * 10 + 5).toFixed(1));
  }
}