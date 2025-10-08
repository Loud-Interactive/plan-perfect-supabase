// process-direct-html-with-storage
// Process HTML content and optionally save to database for PagePerfect integration

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { load } from 'https://esm.sh/cheerio@1.0.0-rc.12';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.36.0';
import { processHtmlContent, cleanText } from '../_shared/encoding-utils.ts';

// Initialize Supabase client
const supabaseUrl = Deno.env.get('SUPABASE_URL') || 'https://jsypctdhynsdqrfifvdh.supabase.co';
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

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
    // Parse request body
    const { 
      html, 
      targetKeyword, 
      url, 
      saveToDatabase = false, 
      clientId, 
      projectId 
    } = await req.json();
    
    if (!html) {
      throw new Error('HTML content is required');
    }
    
    if (!targetKeyword) {
      throw new Error('Target keyword is required');
    }
    
    console.log(`Processing HTML content with target keyword: ${targetKeyword}`);
    
    // Process HTML to fix encoding issues first
    const processedHtml = processHtmlContent(html);
    
    // Extract text from HTML
    const extractedText = await extractTextFromHtml(processedHtml);
    
    // Analyze the content
    const analysis = await analyzeContent(extractedText, targetKeyword, processedHtml, url);
    
    console.log(`Analysis completed for keyword: ${targetKeyword}`);
    
    // If saveToDatabase is true, save the HTML and analysis results
    let dbSaveResult = null;
    if (saveToDatabase) {
      if (!supabaseServiceKey) {
        console.warn('Supabase service key not found. Database save skipped.');
      } else if (!clientId) {
        console.warn('Client ID not provided. Database save skipped.');
      } else {
        dbSaveResult = await saveAnalysisToDatabase(html, analysis, url, targetKeyword, clientId, projectId);
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
 * Save HTML and analysis to database
 */
async function saveAnalysisToDatabase(
  html: string,
  analysis: any,
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
        html_content: processedHtml,
        analysis_result: analysis,
        word_count: analysis.wordCount,
        keyword_density: analysis.keywordDensity,
        overall_score: analysis.overallScore,
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

/**
 * Extract main text content from HTML
 */
async function extractTextFromHtml(html: string): Promise<string> {
  // Use cheerio for extracting text
  const $ = load(html);
  
  // Remove script and style elements
  $('script, style, noscript, iframe, img').remove();
  
  // Get text from body
  const bodyText = $('body').text();
  
  // Clean the text
  return cleanText(bodyText);
}

/**
 * Clean and normalize text
 */
function cleanText(text: string): string {
  return text
    .replace(/\s+/g, ' ')          // Normalize whitespace
    .replace(/\n+/g, '\n')         // Normalize newlines
    .replace(/\t+/g, ' ')          // Replace tabs
    .trim();
}

/**
 * Analyze content for keyword optimization
 */
async function analyzeContent(
  text: string, 
  targetKeyword: string, 
  html: string,
  url?: string
): Promise<any> {
  // Extract heading information from HTML
  const $ = load(html);
  const headings: string[] = [];
  
  $('h1, h2, h3, h4, h5, h6').each((_, elem) => {
    const headingText = $(elem).text().trim();
    if (headingText) {
      const tagName = elem.tagName.toLowerCase();
      headings.push(`${tagName}: ${headingText}`);
    }
  });
  
  // Calculate keyword density
  const words = text.toLowerCase().split(/\s+/);
  const totalWords = words.length;
  
  // Count target keyword occurrences (including partial matches)
  const keywordParts = targetKeyword.toLowerCase().split(/\s+/);
  
  let keywordCount = 0;
  for (let i = 0; i < words.length - keywordParts.length + 1; i++) {
    const potentialMatch = words.slice(i, i + keywordParts.length).join(' ');
    if (potentialMatch === keywordParts.join(' ')) {
      keywordCount++;
    }
  }
  
  // Calculate density percentage
  const keywordDensity = totalWords > 0 ? ((keywordCount / totalWords) * 100).toFixed(2) : '0.00';
  
  // Calculate heading score based on keyword usage in headings
  let headingScore = 0;
  const keywordRegex = new RegExp(targetKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  
  const h1Text = $('h1').text().toLowerCase();
  const h1Count = $('h1').length;
  
  // Check for keyword in H1
  if (h1Count > 0 && keywordRegex.test(h1Text)) {
    headingScore += 40; // Major points for H1
  }
  
  // Check for keyword in other headings
  let headingWithKeywordCount = 0;
  $('h2, h3, h4').each((_, elem) => {
    if (keywordRegex.test($(elem).text().toLowerCase())) {
      headingWithKeywordCount++;
    }
  });
  
  // Add points for other headings containing keyword
  if (headingWithKeywordCount > 0) {
    headingScore += Math.min(headingWithKeywordCount * 15, 40); // Up to 40 points
  }
  
  // Add points for having a reasonable heading structure
  if ($('h2').length > 0) {
    headingScore += 10;
  }
  if ($('h3').length > 0) {
    headingScore += 10;
  }
  
  // Cap at 100
  headingScore = Math.min(headingScore, 100);
  
  // Extract top keywords
  const keywords = extractTopKeywords(text, targetKeyword);
  
  // Calculate overall score
  const densityScore = getDensityScore(parseFloat(keywordDensity));
  const textLengthScore = getTextLengthScore(totalWords);
  const overallScore = Math.round((headingScore * 0.4) + (densityScore * 0.3) + (textLengthScore * 0.3));
  
  // Generate recommendations
  const recommendations = generateRecommendations(
    parseFloat(keywordDensity), 
    headingScore, 
    h1Count, 
    h1Text.includes(targetKeyword.toLowerCase()),
    totalWords,
    keywords,
    targetKeyword
  );
  
  return {
    extractedText: text,
    wordCount: totalWords,
    targetKeyword,
    keywordCount,
    keywordDensity: `${keywordDensity}%`,
    headings,
    headingScore,
    keywords,
    overallScore,
    recommendations,
    url,
    analyzed_at: new Date().toISOString()
  };
}

/**
 * Extract top keywords from text
 */
function extractTopKeywords(text: string, targetKeyword: string): any[] {
  // Normalize text for analysis
  const normalizedText = text.toLowerCase();
  const words = normalizedText.split(/\s+/);
  
  // Remove common stop words
  const stopWords = new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'in', 'on', 'at', 'to', 'for', 'with', 'by', 'about', 'against', 'between', 'into', 'through',
    'during', 'before', 'after', 'above', 'below', 'from', 'up', 'down', 'of', 'off', 'over', 'under',
    'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'any',
    'both', 'each', 'few', 'more', 'most', 'some', 'such', 'no', 'not', 'only', 'own', 'same', 'so',
    'than', 'too', 'very', 'can', 'will', 'just', 'should', 'now'
  ]);
  
  // Count single words first
  const wordCounts: Record<string, number> = {};
  words.forEach(word => {
    if (word.length > 2 && !stopWords.has(word)) {
      wordCounts[word] = (wordCounts[word] || 0) + 1;
    }
  });
  
  // Count 2-word phrases
  const bigramCounts: Record<string, number> = {};
  for (let i = 0; i < words.length - 1; i++) {
    if (words[i].length > 2 && words[i+1].length > 2 && 
        !stopWords.has(words[i]) && !stopWords.has(words[i+1])) {
      const bigram = `${words[i]} ${words[i+1]}`;
      bigramCounts[bigram] = (bigramCounts[bigram] || 0) + 1;
    }
  }
  
  // Count 3-word phrases
  const trigramCounts: Record<string, number> = {};
  for (let i = 0; i < words.length - 2; i++) {
    if (words[i].length > 2 && words[i+1].length > 2 && words[i+2].length > 2 && 
        !stopWords.has(words[i]) && !stopWords.has(words[i+1]) && !stopWords.has(words[i+2])) {
      const trigram = `${words[i]} ${words[i+1]} ${words[i+2]}`;
      trigramCounts[trigram] = (trigramCounts[trigram] || 0) + 1;
    }
  }
  
  // Combine all counts
  const allCounts = { ...wordCounts, ...bigramCounts, ...trigramCounts };
  
  // Convert to array for sorting
  const keywordArray = Object.entries(allCounts)
    .filter(([term, count]) => count > 1) // Only include terms that appear more than once
    .map(([term, count]) => {
      const density = ((count / words.length) * 100).toFixed(2);
      const relevance = calculateKeywordRelevance(term, targetKeyword, count, words.length);
      
      return {
        term,
        count,
        density: `${density}%`,
        relevance
      };
    });
  
  // Sort by count (descending)
  keywordArray.sort((a, b) => b.count - a.count);
  
  // Return top 15 keywords
  return keywordArray.slice(0, 15);
}

/**
 * Calculate relevance score for a keyword compared to target keyword
 */
function calculateKeywordRelevance(keyword: string, targetKeyword: string, count: number, totalWords: number): number {
  const density = (count / totalWords) * 100;
  
  // Calculate basic relevance score
  let relevance = 0;
  
  // Exact match with target keyword
  if (keyword.toLowerCase() === targetKeyword.toLowerCase()) {
    relevance = 100;
  } 
  // Contains the whole target keyword
  else if (keyword.toLowerCase().includes(targetKeyword.toLowerCase())) {
    relevance = 90;
  }
  // Target keyword contains this keyword
  else if (targetKeyword.toLowerCase().includes(keyword.toLowerCase())) {
    relevance = 80;
  }
  // Partial match (any word of target keyword exists in this keyword)
  else {
    const targetWords = targetKeyword.toLowerCase().split(/\s+/);
    const keywordWords = keyword.toLowerCase().split(/\s+/);
    
    for (const targetWord of targetWords) {
      for (const keywordWord of keywordWords) {
        if (targetWord === keywordWord || 
            (targetWord.length > 4 && keywordWord.includes(targetWord)) ||
            (keywordWord.length > 4 && targetWord.includes(keywordWord))) {
          relevance = 70;
          break;
        }
      }
      if (relevance > 0) break;
    }
  }
  
  // If no relevance was determined based on matching, calculate based on frequency
  if (relevance === 0) {
    // For high-frequency keywords, give some relevance
    if (density > 1.0) {
      relevance = 40;
    } else if (density > 0.5) {
      relevance = 30;
    } else {
      relevance = 20;
    }
  }
  
  return relevance;
}

/**
 * Get score for keyword density
 */
function getDensityScore(density: number): number {
  if (density >= 0.5 && density <= 3) {
    return 100; // Optimal density
  } else if (density > 3 && density <= 5) {
    return 70; // A bit high
  } else if (density > 5) {
    return 40; // Too high (keyword stuffing)
  } else {
    // Too low, score based on how close to 0.5%
    return Math.round((density / 0.5) * 80);
  }
}

/**
 * Get score for text length
 */
function getTextLengthScore(wordCount: number): number {
  if (wordCount >= 1000) {
    return 100;
  } else if (wordCount >= 700) {
    return 90;
  } else if (wordCount >= 500) {
    return 80;
  } else if (wordCount >= 300) {
    return 60;
  } else if (wordCount >= 100) {
    return 40;
  } else {
    return 20;
  }
}

/**
 * Generate optimization recommendations
 */
function generateRecommendations(
  density: number,
  headingScore: number,
  h1Count: number,
  h1HasKeyword: boolean,
  wordCount: number,
  keywords: any[],
  targetKeyword: string
): string[] {
  const recommendations: string[] = [];
  
  // Density recommendations
  if (density > 5) {
    recommendations.push(`Keyword density (${density.toFixed(2)}%) is too high. Reduce the usage of "${targetKeyword}" to avoid keyword stuffing.`);
  } else if (density < 0.5) {
    recommendations.push(`Keyword density (${density.toFixed(2)}%) is too low. Increase the natural usage of "${targetKeyword}" throughout the content.`);
  }
  
  // Heading recommendations
  if (h1Count === 0) {
    recommendations.push('Add an H1 heading that includes your target keyword.');
  } else if (h1Count > 1) {
    recommendations.push('Multiple H1 headings detected. For SEO best practices, use only one H1 heading per page.');
  } else if (!h1HasKeyword) {
    recommendations.push(`Include your target keyword "${targetKeyword}" in the H1 heading.`);
  }
  
  if (headingScore < 60) {
    recommendations.push('Improve your heading structure by including target keywords in H2 and H3 headings.');
  }
  
  // Content length recommendations
  if (wordCount < 300) {
    recommendations.push(`Content is too short (${wordCount} words). Aim for at least 500-700 words for better SEO performance.`);
  } else if (wordCount < 700) {
    recommendations.push(`Consider expanding your content. Current length is ${wordCount} words, while 700-1000+ words is optimal for most topics.`);
  }
  
  // Related keywords recommendations
  const relatedKeywords = keywords
    .filter(k => k.relevance >= 70 && k.term.toLowerCase() !== targetKeyword.toLowerCase())
    .slice(0, 3)
    .map(k => k.term);
    
  if (relatedKeywords.length > 0) {
    recommendations.push(`Continue using and possibly expand on these relevant terms: ${relatedKeywords.join(', ')}.`);
  }
  
  const lowFreqKeywords = keywords
    .filter(k => k.relevance >= 80 && parseFloat(k.density.replace('%', '')) < 0.5)
    .slice(0, 2)
    .map(k => k.term);
    
  if (lowFreqKeywords.length > 0) {
    recommendations.push(`Increase usage of these highly relevant terms: ${lowFreqKeywords.join(', ')}.`);
  }
  
  return recommendations;
}