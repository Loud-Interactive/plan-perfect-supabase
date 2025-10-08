// process-direct-html-llm
// Process HTML content using Claude LLM for advanced analysis and save to database

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
// Removed article extractor - using cheerio only
import { load } from 'https://esm.sh/cheerio@1.0.0-rc.12';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.36.0';
import { AnthropicClient, ContentBlockValue } from 'https://esm.sh/@anthropic-ai/sdk';
import { cleanText as cleanTextUtil, processHtmlContent } from '../_shared/encoding-utils.ts';

// Initialize Supabase client
const supabaseUrl = Deno.env.get('SUPABASE_URL') || 'https://jsypctdhynsdqrfifvdh.supabase.co';
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

// Initialize Anthropic client
const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY') || '';
const anthropic = new AnthropicClient({
  apiKey: anthropicApiKey,
});

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight request
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  
  try {
    if (!anthropicApiKey) {
      throw new Error('ANTHROPIC_API_KEY environment variable is not set');
    }
    
    // Parse request body
    const { 
      html, 
      targetKeyword, 
      url, 
      saveToDatabase = false, 
      clientId, 
      projectId,
      modelVersion = 'claude-3-opus-20240229' // Default to highest quality model
    } = await req.json();
    
    if (!html) {
      throw new Error('HTML content is required');
    }
    
    if (!targetKeyword) {
      throw new Error('Target keyword is required');
    }
    
    console.log(`Processing HTML content with target keyword: ${targetKeyword} using LLM analysis`);
    
    // Extract text from HTML
    const { extractedText, cheerioInstance } = await extractContentFromHtml(html);
    
    // Prepare headings list for additional context
    const headings = extractHeadings(cheerioInstance);
    
    // Use Claude LLM for analysis
    const analysis = await runLlmAnalysis(extractedText, targetKeyword, headings, url, modelVersion);
    
    console.log(`LLM analysis completed for ${url || 'content'}`);
    
    // Calculate word count for storage
    const wordCount = calculateWordCount(extractedText);
    
    // If saveToDatabase is true, save the HTML and analysis results
    let dbSaveResult = null;
    if (saveToDatabase) {
      if (!supabaseServiceKey) {
        console.warn('Supabase service key not found. Database save skipped.');
      } else if (!clientId) {
        console.warn('Client ID not provided. Database save skipped.');
      } else {
        dbSaveResult = await saveAnalysisToDatabase(html, analysis, extractedText, wordCount, url, targetKeyword, clientId, projectId);
        console.log(`Analysis saved to database with ID: ${dbSaveResult?.id || 'unknown'}`);
      }
    }
    
    return new Response(
      JSON.stringify({
        success: true,
        analysis,
        databaseSave: dbSaveResult ? {
          success: true,
          id: dbSaveResult.id,
          table: dbSaveResult.table
        } : {
          success: false,
          reason: !saveToDatabase ? 'Save not requested' : 
                 !supabaseServiceKey ? 'Database credentials missing' : 
                 !clientId ? 'Client ID required' : 'Unknown error'
        }
      }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error) {
    console.error('Error processing HTML:', error);
    
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

/**
 * Extract content from HTML using cheerio
 */
async function extractContentFromHtml(html: string): Promise<{ extractedText: string, cheerioInstance: any }> {
  // Process HTML content to fix encoding issues first
  const processedHtml = processHtmlContent(html);
  
  // Load HTML into cheerio
  const $ = load(processedHtml);
  
  // Remove unwanted elements
  $('script, style, noscript, iframe, nav, footer, header, aside').remove();
  
  // Try to find main content areas first
  const mainSelectors = ['main', 'article', '.content', '.main-content', '#content', '#main', '.post-content', '.entry-content'];
  let extractedText = '';
  
  // Try to find main content using common selectors
  for (const selector of mainSelectors) {
    const mainContent = $(selector).text().trim();
    if (mainContent && mainContent.length > 200) {
      extractedText = mainContent;
      break;
    }
  }
  
  // If no main content found, fall back to body
  if (!extractedText) {
    extractedText = $('body').text();
  }
  
  // Clean the text using encoding utilities
  extractedText = cleanTextUtil(extractedText);
  
  return { extractedText, cheerioInstance: $ };
}

/**
 * Extract headings from HTML for additional context
 */
function extractHeadings($: any): string[] {
  const headings: string[] = [];
  
  $('h1, h2, h3, h4, h5, h6').each((_, elem) => {
    const rawHeadingText = $(elem).text().trim();
    if (rawHeadingText) {
      // Clean heading text using encoding utilities
      const headingText = cleanTextUtil(rawHeadingText);
      const tagName = elem.tagName.toLowerCase();
      headings.push(`${tagName}: ${headingText}`);
    }
  });
  
  return headings;
}


/**
 * Calculate word count
 */
function calculateWordCount(text: string): number {
  return text.split(/\s+/).filter(word => word.length > 0).length;
}

/**
 * Run LLM analysis using Claude
 */
async function runLlmAnalysis(
  text: string,
  targetKeyword: string,
  headings: string[],
  url?: string,
  modelVersion = 'claude-3-opus-20240229'
): Promise<any> {
  console.log(`Running LLM analysis with model: ${modelVersion}`);
  
  // Create a context-rich prompt for Claude
  const systemPrompt = `You are an expert SEO content analyzer. You'll receive HTML content to analyze for SEO optimization against a target keyword.
Provide a detailed, objective analysis focused on how well the content is optimized for the target keyword.

Analyze the following aspects:
1. Keyword Usage & Density: How well the target keyword is used throughout the content
2. Heading Structure: Analysis of heading tags (H1-H6) and keyword presence in headings
3. Content Quality: Assessment of overall content quality, relevance, and depth
4. Word Count: Whether the content length is appropriate for the topic
5. Top Keywords: What keywords appear most frequently in the content
6. Optimization Recommendations: Specific suggestions for improving SEO performance

Your output should be formatted as a detailed JSON object with the following structure:
{
  "extractedText": "Brief sample of the analyzed content (max 150 words)",
  "wordCount": number,
  "targetKeyword": "the target keyword",
  "keywordCount": number,
  "keywordDensity": "percentage with % symbol",
  "headingScore": number (0-100),
  "headings": ["list of headings found in content with tags"],
  "keywords": [
    { "term": "keyword", "count": number, "density": "percentage", "relevance": number (0-100) }
  ],
  "overallScore": number (0-100),
  "recommendations": ["specific recommendations for improvement"],
  "contentQualityAnalysis": {
    "relevance": number (0-100),
    "depth": number (0-100),
    "readability": number (0-100),
    "comprehensiveness": number (0-100)
  },
  "keywordPositioning": {
    "inTitle": boolean,
    "inFirstParagraph": boolean,
    "inLastParagraph": boolean,
    "inURLSlug": boolean,
    "inHeadings": number
  }
}`;

  // Format the headings for inclusion in the prompt
  const headingsFormatted = headings.length > 0 
    ? `\nHeadings found in the content:\n${headings.join('\n')}`
    : '\nNo clear headings found in the content.';
  
  // Prepare the message for Claude
  const urlContext = url ? `Content from URL: ${url}` : 'Content from direct HTML input';
  
  try {
    const message = await anthropic.messages.create({
      model: modelVersion,
      max_tokens: 4000,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Please analyze this content for SEO optimization against the target keyword: "${targetKeyword}".

${urlContext}
${headingsFormatted}

Content to analyze:
${text.slice(0, 15000)} ${text.length > 15000 ? '... (content truncated for length)' : ''}`
            }
          ]
        }
      ]
    });
    
    // Extract the JSON from Claude's response
    let analysisJson: any;
    try {
      // Find the JSON in the response
      const jsonContent = message.content
        .filter((content: ContentBlockValue) => content.type === 'text')
        .map((content: ContentBlockValue) => content.text)
        .join("")
        .replace(/```json\s*([\s\S]*?)\s*```/g, '$1') // Remove markdown code blocks
        .trim();
      
      // Parse the JSON
      analysisJson = JSON.parse(jsonContent);
    } catch (e) {
      console.error('Error parsing LLM response JSON:', e);
      throw new Error('Failed to parse LLM analysis output');
    }
    
    return analysisJson;
  } catch (error) {
    console.error('LLM API error:', error);
    throw new Error(`Failed to get analysis from Claude: ${error.message || 'Unknown error'}`);
  }
}

/**
 * Save analysis to database
 */
async function saveAnalysisToDatabase(
  html: string,
  analysis: any,
  extractedText: string,
  wordCount: number,
  url: string,
  targetKeyword: string,
  clientId: string,
  projectId?: string
): Promise<{ id: string, table: string } | null> {
  try {
    // Create Supabase client
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Save to content_analysis table
    const timestamp = new Date().toISOString();
    
    const { data, error } = await supabase
      .from('content_analysis')
      .insert({
        client_id: clientId,
        project_id: projectId || null,
        url: url,
        target_keyword: targetKeyword,
        html_content: html,
        extracted_text: extractedText,
        analysis_result: analysis,
        word_count: wordCount,
        keyword_density: parseFloat(analysis.keywordDensity?.replace('%', '')) || 0,
        overall_score: analysis.overallScore || 0,
        created_at: timestamp,
        updated_at: timestamp
      })
      .select('id')
      .single();
    
    if (error) {
      console.error('Error saving to database:', error);
      return null;
    }
    
    return { id: data.id, table: 'content_analysis' };
  } catch (error) {
    console.error('Database save error:', error);
    return null;
  }
}