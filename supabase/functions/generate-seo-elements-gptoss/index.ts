// PagePerfect: generate-seo-elements-gptoss (Groq GPT-OSS-120B version)
// Function to generate SEO-optimized elements using Groq's GPT-OSS-120B with reasoning
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import { callGPT120OSSWithLogging } from '../utils/model-logging.ts';
import { cleanText, decodeHtmlEntities } from '../_shared/encoding-utils.ts';
import { 
  generateOrGetCachedSchema, 
  buildEnhancedPrompt, 
  extractCustomSeoData,
  validateCustomFields,
  storeEnhancedSEOResults 
} from '../utils/custom-fields.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { getGSCAccessToken, checkSiteUrl, extractDomain as extractGscDomain } from '../utils-gsc/index.ts';

const FUNCTION_NAME = 'generate-seo-elements-gptoss';

// Default regex pattern - matches nothing (allows all keywords through)
// This is used as a fallback if no domain-specific pattern is found
// We use a pattern that never matches so all keywords are considered valid when no domain pattern exists
const DEFAULT_INVALID_KEYWORD_PATTERN = /(?!.*)/;

// Cache for domain-specific regex patterns
const domainRegexCache = new Map<string, RegExp>();

// Function to parse regex string with flags
function parseRegexString(regexStr: string): RegExp {
  try {
    // Handle empty or whitespace-only patterns
    if (!regexStr || !regexStr.trim()) {
      console.warn('Empty regex pattern provided, using default');
      return DEFAULT_INVALID_KEYWORD_PATTERN;
    }

    // Clean up the pattern
    let pattern = regexStr.trim();
    let flags = 'i'; // Default to case-insensitive

    // Remove (?i) notation (PCRE case-insensitive flag not valid in JS)
    pattern = pattern.replace(/\(\?i\)/g, '');

    // Check if the string has regex delimiters and flags (e.g., /pattern/flags)
    const delimiterMatch = pattern.match(/^\/(.*)\/([gimsuvy]*)$/);
    if (delimiterMatch) {
      pattern = delimiterMatch[1];
      flags = delimiterMatch[2] || 'i';
      // Remove 'g' flag as it causes issues with test() method
      flags = flags.replace(/g/g, '');
      return new RegExp(pattern, flags);
    }

    // Check for flags at the end after a delimiter or pipe (e.g., pattern/gm or pattern|gm)
    // This handles cases where the database might have stored "pattern/gm" or "pattern|gm"
    const flagMatch = pattern.match(/^(.*?)[\\/|]([gimsuvy]+)$/);
    if (flagMatch && flagMatch[2]) {
      pattern = flagMatch[1];
      flags = flagMatch[2];
      // Remove 'g' flag as it causes issues with test() method
      flags = flags.replace(/g/g, '');
    }

    // IMPORTANT: For chatsworth pattern that ends with /gm but isn't properly delimited
    // Example: "chatsworth.*|(?i)(chats?wor(th|t)|cpi\b|...)/gm"
    // We need to extract just the pattern part
    if (pattern.endsWith('/gm') || pattern.endsWith('/gi') || pattern.endsWith('/g')) {
      const lastSlashIndex = pattern.lastIndexOf('/');
      if (lastSlashIndex > 0) {
        const possibleFlags = pattern.substring(lastSlashIndex + 1);
        if (/^[gimsuvy]+$/.test(possibleFlags)) {
          pattern = pattern.substring(0, lastSlashIndex);
          flags = possibleFlags.replace(/g/g, ''); // Remove 'g' flag
          if (!flags.includes('i')) flags += 'i'; // Ensure case-insensitive
        }
      }
    }

    // Create the regex with the cleaned pattern
    return new RegExp(pattern, flags);
  } catch (error) {
    console.error(`Error parsing regex string "${regexStr}": ${error.message}`);
    return DEFAULT_INVALID_KEYWORD_PATTERN;
  }
}

// Function to load domain-specific regex from pairs table
async function loadDomainRegex(supabaseClient: any, domain: string): Promise<RegExp> {
  // Normalize domain by removing www. prefix for consistency
  const normalizedDomain = domain.replace(/^www\./i, '');
  
  // Check cache first (using normalized domain)
  if (domainRegexCache.has(normalizedDomain)) {
    return domainRegexCache.get(normalizedDomain)!;
  }
  
  console.log(`[DEBUG] Looking up regex for normalized domain: ${normalizedDomain} (original: ${domain})`);
  
  try {
    // Query the pairs table for branded_terms_regex_code
    // Order by last_updated desc to get the most recent entry if there are duplicates
    const { data, error } = await supabaseClient
      .from('pairs')
      .select('value, last_updated')
      .eq('domain', normalizedDomain)
      .eq('key', 'branded_terms_regex_code')
      .order('last_updated', { ascending: false })
      .limit(1);

    if (error) {
      console.error(`[ERROR] Failed to load regex for ${normalizedDomain}:`, error);
      domainRegexCache.set(normalizedDomain, DEFAULT_INVALID_KEYWORD_PATTERN);
      return DEFAULT_INVALID_KEYWORD_PATTERN;
    }

    if (!data || data.length === 0) {
      console.warn(`[WARN] No branded_terms_regex_code found for ${normalizedDomain}, not filtering keywords`);
      domainRegexCache.set(normalizedDomain, DEFAULT_INVALID_KEYWORD_PATTERN);
      return DEFAULT_INVALID_KEYWORD_PATTERN;
    }

    if (!data[0]?.value || data[0].value.trim() === '') {
      console.warn(`[WARN] Empty regex pattern for ${normalizedDomain}, not filtering keywords`);
      domainRegexCache.set(normalizedDomain, DEFAULT_INVALID_KEYWORD_PATTERN);
      return DEFAULT_INVALID_KEYWORD_PATTERN;
    }

    // Parse the regex string from the database
    console.log(`[DEBUG] Raw regex from DB for ${normalizedDomain}: "${data[0].value}"`);
    const regex = parseRegexString(data[0].value);
    console.log(`[DEBUG] Parsed regex for ${normalizedDomain}: ${regex}, flags: ${regex.flags}, global: ${regex.global}`);
    console.log(`Loaded domain-specific regex for ${normalizedDomain} (updated: ${data[0].last_updated})`);
    
    // Cache the result (use normalized domain as key)
    domainRegexCache.set(normalizedDomain, regex);
    return regex;
  } catch (error) {
    console.error(`Error loading domain regex for ${normalizedDomain}: ${error.message}`);
    domainRegexCache.set(normalizedDomain, DEFAULT_INVALID_KEYWORD_PATTERN);
    return DEFAULT_INVALID_KEYWORD_PATTERN;
  }
}

// Function to validate a keyword (filters out brand terms)
async function isValidKeyword(keyword: string, pattern: RegExp): Promise<boolean> {
  if (!keyword || typeof keyword !== 'string') {
    return false;
  }
  
  // Reset pattern state if it has global flag (safety check)
  if (pattern.global) {
    pattern.lastIndex = 0;
  }
  
  // Test if the keyword matches the pattern (if it matches, it's a branded term and should be filtered out)
  const isBrandedTerm = pattern.test(keyword.toLowerCase());
  
  // Log for debugging
  if (isBrandedTerm) {
    console.log(`Filtered out branded term: "${keyword}"`);
  }
  
  return !isBrandedTerm;
}

/**
 * Check indexation status using Google URL Inspection API
 */
async function checkIndexationStatus(url: string): Promise<{
  indexation_status: string | null;
  indexation_emoji: string | null;
  indexation_details: any | null;
  indexation_last_crawl_time: string | null;
  indexation_page_fetch_state: string | null;
  indexation_google_canonical: string | null;
  indexation_user_canonical: string | null;
  indexation_sitemap_presence: string | null;
  indexation_referring_urls: string[] | null;
  indexation_crawled_as: string | null;
  indexation_robots_txt_state: string | null;
  indexation_checked_at: string;
}> {
  const defaultResult = {
    indexation_status: null,
    indexation_emoji: null,
    indexation_details: null,
    indexation_last_crawl_time: null,
    indexation_page_fetch_state: null,
    indexation_google_canonical: null,
    indexation_user_canonical: null,
    indexation_sitemap_presence: null,
    indexation_referring_urls: null,
    indexation_crawled_as: null,
    indexation_robots_txt_state: null,
    indexation_checked_at: new Date().toISOString()
  };

  try {
    // Get GSC access token
    const accessToken = await getGSCAccessToken();
    
    // Extract domain and get proper site URL format
    const domain = extractGscDomain(url);
    const siteUrl = await checkSiteUrl(accessToken, domain);
    
    // Call URL Inspection API
    const response = await fetch('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        inspectionUrl: url,
        siteUrl: siteUrl,
      }),
    });

    if (!response.ok) {
      console.error(`URL Inspection API error for ${url}: ${response.status}`);
      return defaultResult;
    }

    const result = await response.json();
    const inspectionResult = result.inspectionResult;
    
    // Extract coverage state and emoji
    const coverageState = inspectionResult?.indexStatusResult?.coverageState || 'URL is unknown to Google';
    const emoji = getIndexationEmoji(coverageState);
    
    // Extract detailed information
    const lastCrawlTime = inspectionResult?.indexStatusResult?.lastCrawlTime || null;
    const pageFetchState = inspectionResult?.indexStatusResult?.pageFetchState || null;
    const googleCanonical = inspectionResult?.indexStatusResult?.googleCanonical || null;
    const userCanonical = inspectionResult?.indexStatusResult?.userDeclaredCanonical || null;
    const sitemaps = inspectionResult?.indexStatusResult?.sitemap || [];
    const referringUrls = inspectionResult?.indexStatusResult?.referringUrls || [];
    const crawledAs = inspectionResult?.indexStatusResult?.crawledAs || null;
    const robotsTxtState = inspectionResult?.indexStatusResult?.robotsTxtState || null;
    
    return {
      indexation_status: coverageState,
      indexation_emoji: emoji,
      indexation_details: inspectionResult,
      indexation_last_crawl_time: lastCrawlTime,
      indexation_page_fetch_state: pageFetchState,
      indexation_google_canonical: googleCanonical,
      indexation_user_canonical: userCanonical,
      indexation_sitemap_presence: sitemaps.length > 0 ? sitemaps.join(', ') : null,
      indexation_referring_urls: referringUrls.length > 0 ? referringUrls : null,
      indexation_crawled_as: crawledAs,
      indexation_robots_txt_state: robotsTxtState,
      indexation_checked_at: new Date().toISOString()
    };
  } catch (error) {
    console.error(`Error checking indexation for ${url}:`, error);
    return defaultResult;
  }
}

/**
 * Get emoji for indexation status
 */
function getIndexationEmoji(status: string): string {
  const emojiMap: Record<string, string> = {
    "Submitted and indexed": "✅",
    "Duplicate without user-selected canonical": "😵",
    "Crawled - currently not indexed": "👀",
    "Discovered - currently not indexed": "👀",
    "Page with redirect": "🔀",
    "URL is unknown to Google": "❓",
    "Excluded by 'noindex' tag": "🚫",
    "Blocked by robots.txt": "⛔",
    "Soft 404": "💀",
    "Alternate page with proper canonical tag": "🔗",
    "Duplicate, Google chose different canonical than user": "🤔",
    "Excluded": "❌",
    "Excluded by page removal tool": "🗑️",
    "Blocked by page removal tool": "🚧",
    "Blocked due to unauthorized request (401)": "🔐",
    "Crawl anomaly": "⚠️",
    "Blocked due to access forbidden (403)": "🔒",
    "Page not found (404)": "🔍",
    "Blocked due to other 4xx issue": "⚡"
  };
  return emojiMap[status] || "❌";
}

// Helper: fetch pairs data for a given domain as a flat key/value object
async function fetchPairsDataForDomain(supabaseClient: any, domain: string): Promise<Record<string, any>> {
  const result: Record<string, any> = {};
  if (!domain) {
    console.warn('No domain provided for pairs lookup');
    return result;
  }

  const cleanDomain = domain.startsWith('www.') ? domain.substring(4) : domain;
  console.log(`Looking up pairs data for domain: ${cleanDomain}`);

  const { data: pairsRawData, error: pairsError } = await supabaseClient
    .from('pairs')
    .select('key, value')
    .eq('domain', cleanDomain);

  if (pairsError) {
    console.error('Error fetching pairs data:', pairsError);
    return result;
  }

  if (pairsRawData && pairsRawData.length > 0) {
    pairsRawData.forEach(pair => {
      result[pair.key] = pair.value;
    });
    console.log(`Loaded ${Object.keys(result).length} pairs for domain: ${cleanDomain}`);
  } else {
    console.log(`No pairs data found for domain: ${cleanDomain}`);
  }

  return result;
}

interface RequestBody {
  url: string;
  pageId?: string;
  groqApiKey?: string;
  modelName?: string;
  customFieldsDescription?: string;
  includeCustomFields?: boolean;
  cacheSchema?: boolean;
}

/**
 * Fetch and aggregate GSC data for a page
 */
async function fetchAndAggregateGscData(
  supabaseClient: any,
  pageUrl: string
): Promise<{
  gsc_impressions: number | null;
  gsc_clicks: number | null;
  gsc_ctr: number | null;
  gsc_average_rank: number | null;
  gsc_data_date: string | null;
  has_gsc_data: boolean;
  is_indexed: boolean;
  top_performing_keyword: string | null;
}> {
  try {
    console.log(`Fetching GSC data for URL: ${pageUrl}`);
    
    // Query GSC data for this specific page
    const { data: gscResults, error: gscError } = await supabaseClient
      .from('gsc_keywords')
      .select('keyword, clicks, impressions, ctr, position, fetched_date')
      .eq('page_url', pageUrl)
      .order('impressions', { ascending: false })
      .limit(100); // Get top 100 keywords for better aggregation
    
    if (gscError || !gscResults || gscResults.length === 0) {
      console.log('No GSC data found for this page');
      return {
        gsc_impressions: null,
        gsc_clicks: null,
        gsc_ctr: null,
        gsc_average_rank: null,
        gsc_data_date: null,
        has_gsc_data: false,
        is_indexed: false,
        top_performing_keyword: null
      };
    }
    
    console.log(`Found ${gscResults.length} GSC keyword records`);
    
    // Aggregate GSC data
    const totalImpressions = gscResults.reduce((sum, row) => sum + (row.impressions || 0), 0);
    const totalClicks = gscResults.reduce((sum, row) => sum + (row.clicks || 0), 0);
    
    // Calculate weighted average position (weighted by impressions)
    let weightedPositionSum = 0;
    let totalWeight = 0;
    gscResults.forEach(row => {
      const weight = row.impressions || 0;
      weightedPositionSum += (row.position || 0) * weight;
      totalWeight += weight;
    });
    const avgPosition = totalWeight > 0 ? weightedPositionSum / totalWeight : 0;
    
    // Calculate CTR
    const avgCtr = totalImpressions > 0 ? totalClicks / totalImpressions : 0;
    
    // Get most recent data date
    const latestDate = gscResults
      .map(r => r.fetched_date)
      .filter(d => d)
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];
    
    // Find top performing keyword (highest clicks)
    const topKeyword = gscResults.reduce((best, row) => {
      if (!best || (row.clicks || 0) > (best.clicks || 0)) return row;
      return best;
    }, null);
    
    // Page is indexed if it has impressions
    const isIndexed = totalImpressions > 0;
    
    return {
      gsc_impressions: Math.round(totalImpressions),
      gsc_clicks: Math.round(totalClicks),
      gsc_ctr: parseFloat(avgCtr.toFixed(4)),
      gsc_average_rank: parseFloat(avgPosition.toFixed(2)),
      gsc_data_date: latestDate || new Date().toISOString().split('T')[0],
      has_gsc_data: true,
      is_indexed: isIndexed,
      top_performing_keyword: topKeyword?.keyword || null
    };
  } catch (error) {
    console.error(`Error fetching GSC data: ${error.message}`);
    return {
      gsc_impressions: null,
      gsc_clicks: null,
      gsc_ctr: null,
      gsc_average_rank: null,
      gsc_data_date: null,
      has_gsc_data: false,
      is_indexed: false,
      top_performing_keyword: null
    };
  }
}

/**
 * Calculate GSC metrics from keywords array (existing keywords from earlier in function)
 * This is a fallback if we already have keywords loaded
 */
function calculateGscMetricsFromKeywords(keywords: any[]) {
  if (!keywords || keywords.length === 0) {
    return {
      gsc_impressions: null,
      gsc_clicks: null,
      gsc_ctr: null,
      gsc_average_rank: null,
      has_gsc_data: false
    };
  }

  // Filter out AI-generated keywords to get only real GSC data
  const gscKeywords = keywords.filter(kw => !kw.ai_generated);
  
  if (gscKeywords.length === 0) {
    return {
      gsc_impressions: 0,
      gsc_clicks: 0,
      gsc_ctr: 0,
      gsc_average_rank: null,
      has_gsc_data: false
    };
  }

  // Calculate totals and weighted average position
  const totalImpressions = gscKeywords.reduce((sum, kw) => sum + (kw.impressions || 0), 0);
  const totalClicks = gscKeywords.reduce((sum, kw) => sum + (kw.clicks || 0), 0);
  
  const weightedPositionSum = gscKeywords.reduce((sum, kw) => {
    const impressions = kw.impressions || 0;
    const position = kw.position || 0;
    return sum + (position * impressions);
  }, 0);
  
  const avgPosition = totalImpressions > 0 ? weightedPositionSum / totalImpressions : null;
  const ctr = totalImpressions > 0 ? totalClicks / totalImpressions : 0;

  return {
    gsc_impressions: Math.round(totalImpressions),
    gsc_clicks: Math.round(totalClicks),
    gsc_ctr: parseFloat(ctr.toFixed(4)),
    gsc_average_rank: avgPosition ? parseFloat(avgPosition.toFixed(2)) : null,
    has_gsc_data: true
  };
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
    const { 
      url, 
      pageId, 
      groqApiKey,
      modelName = 'openai/gpt-oss-120b',
      customFieldsDescription,
      includeCustomFields = false,
      cacheSchema = true
    } = await req.json() as RequestBody;

    if (!url && !pageId) {
      throw new Error('Either url or pageId is required');
    }

    // Use API key from request or environment variable
    const apiKey = groqApiKey || Deno.env.get('GROQ_API_KEY');
    if (!apiKey) {
      throw new Error('Groq API key is required');
    }

    console.log(`Generating SEO elements for ${url || `pageId: ${pageId}`} using Groq GPT-OSS-120B`);

    // Get page data
    let pageData: any;
    let pageContent: string;
    let pageKeywords: any[] = [];
    let domain: string | undefined;
    let domainRegex = DEFAULT_INVALID_KEYWORD_PATTERN;
    let pairsData: Record<string, any> = {};

    if (pageId) {
      // Fetch page data from the database with enhanced canonical tracking
      const { data, error } = await supabaseClient
        .from('pages')
        .select('url, html, domain, http_status, canonical_url, original_url')
        .eq('id', pageId)
        .single();

      if (error || !data) {
        throw new Error(`Error fetching page: ${error?.message || 'Page not found'}`);
      }

      pageData = data;
      
      // ENHANCED: Check HTTP status before proceeding with SEO
      if (pageData.http_status && pageData.http_status !== 200) {
        console.log(`⚠️ Page has non-200 HTTP status: ${pageData.http_status}`);
        return new Response(
          JSON.stringify({
            success: false,
            error: `Cannot generate SEO for non-200 status page`,
            httpStatus: pageData.http_status,
            url: pageData.url,
            canonicalUrl: pageData.canonical_url,
            originalUrl: pageData.original_url,
            reason: 'Pages with 4xx/5xx status codes should not get SEO recommendations'
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

      // Log canonical URL information for debugging
      if (pageData.canonical_url && pageData.canonical_url !== pageData.url) {
        console.log(`📍 Canonical URL detected: ${pageData.canonical_url} (original: ${pageData.url})`);
      }
      if (pageData.original_url && pageData.original_url !== pageData.url) {
        console.log(`🔄 Original URL: ${pageData.original_url} -> canonical: ${pageData.url}`);
      }

      domain = pageData.domain;
      console.log(`[DEBUG] Processing page ${pageId} with domain: ${domain}`);
      if (domain) {
        pairsData = await fetchPairsDataForDomain(supabaseClient, domain);
      }
      
      // Load domain-specific regex for keyword filtering
      if (domain) {
        console.log(`[DEBUG] Loading regex for domain: ${domain}`);
        domainRegex = await loadDomainRegex(supabaseClient, domain);
        console.log(`[DEBUG] Loaded regex pattern: ${domainRegex}`);
      } else {
        console.warn(`[WARN] No domain found for page ${pageId}, using default pattern`);
      }
      
      // Convert HTML to markdown for better processing
      if (!pageData.html) {
        console.error(`No HTML content found for page ${pageId}`);
        throw new Error(`No HTML content found for page ${pageId}. The page may not have been crawled yet.`);
      }
      pageContent = htmlToMarkdown(pageData.html);
      
      // First check page_seo_recommendations table for keywords
      try {
        const { data: recKeywords, error: recError } = await supabaseClient
          .from('page_seo_recommendations')
          .select('keywords')
          .eq('page_id', pageId)
          .single();
          
        if (!recError && recKeywords?.keywords && Array.isArray(recKeywords.keywords) && recKeywords.keywords.length > 0) {
          console.log(`[DEBUG] Found ${recKeywords.keywords.length} keywords in page_seo_recommendations`);
          console.log(`[DEBUG] Domain: ${domain}, Regex pattern: ${domainRegex}`);
          console.log(`[DEBUG] First keyword structure:`, JSON.stringify(recKeywords.keywords[0]));
          
          const validKeywords = [];
          for (const k of recKeywords.keywords) {
            const isValid = await isValidKeyword(k.keyword, domainRegex);
            console.log(`[DEBUG] Keyword "${k.keyword}" - Valid: ${isValid}`);
            if (isValid) {
              validKeywords.push(k);
            }
          }
          pageKeywords = validKeywords;
          console.log(`[DEBUG] After filtering: ${pageKeywords.length} valid keywords out of ${recKeywords.keywords.length} total`);
        }
      } catch (keywordError) {
        console.error(`Error checking recommendations table: ${keywordError.message}`);
      }
      
      // If no keywords yet, try GSC keywords
      if (!pageKeywords || pageKeywords.length === 0) {
        const { data: keywordsData, error: keywordsError } = await supabaseClient
          .from('gsc_keywords')
          .select('keyword, clicks, impressions, position, ctr')
          .eq('page_id', pageId)
          .order('impressions', { ascending: false })
          .limit(20);
          
        if (!keywordsError && keywordsData && keywordsData.length > 0) {
          console.log(`[DEBUG] Found ${keywordsData.length} keywords in gsc_keywords`);
          console.log(`[DEBUG] Domain: ${domain}, Regex pattern: ${domainRegex}`);
          console.log(`[DEBUG] First GSC keyword:`, JSON.stringify(keywordsData[0]));
          
          const validKeywords = [];
          for (const k of keywordsData) {
            const isValid = await isValidKeyword(k.keyword, domainRegex);
            console.log(`[DEBUG] GSC Keyword "${k.keyword}" - Valid: ${isValid}`);
            if (isValid) {
              validKeywords.push(k);
            }
          }
          pageKeywords = validKeywords;
          console.log(`[DEBUG] After filtering GSC: ${pageKeywords.length} valid keywords out of ${keywordsData.length} total`);
        }
      }
      
      // If we still have fewer than 3 keywords, generate some using AI
      if (!pageKeywords || pageKeywords.length < 3) {
        console.log(`Found only ${pageKeywords?.length || 0} keywords, generating additional keywords with AI`);
        
        try {
          const keywordResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/extract-content-keywords`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
            },
            body: JSON.stringify({
              pageId: pageId,
              saveToDatabase: false // We'll merge them ourselves
            })
          });
          
          if (keywordResponse.ok) {
            const keywordResult = await keywordResponse.json();
            
            if (keywordResult.success && Array.isArray(keywordResult.gscCompatibleKeywords)) {
              if (!pageKeywords) pageKeywords = [];
              
              // Combine existing keywords with AI-generated ones
              const existingKeywordTexts = new Set(pageKeywords.map(k => k.keyword?.toLowerCase()));
              
              // Add AI keywords that don't duplicate existing ones and are valid
              for (const aiKeyword of keywordResult.gscCompatibleKeywords) {
                const isValid = await isValidKeyword(aiKeyword.keyword, domainRegex);
                if (!existingKeywordTexts.has(aiKeyword.keyword?.toLowerCase()) && isValid) {
                  pageKeywords.push({
                    ...aiKeyword,
                    ai_generated: true,
                  });
                  existingKeywordTexts.add(aiKeyword.keyword?.toLowerCase());
                  
                  // Once we have at least 5 keywords total, we can stop
                  if (pageKeywords.length >= 5) break;
                }
              }
              
              console.log(`Added AI-generated keywords, now have ${pageKeywords.length} total`);
            }
          }
        } catch (aiError) {
          console.error(`Error generating AI keywords: ${aiError.message}`);
        }
      }
    } else {
      // For URL-only requests, we'll need to fetch the content
      pageData = { url };
      
      // Try to extract domain from URL for logging purposes
      try {
        const urlObj = new URL(url);
        domain = urlObj.hostname;
        // Remove www if present
        if (domain.startsWith('www.')) {
          domain = domain.substring(4);
        }
        // Load domain-specific regex for keyword filtering
        if (domain) {
          pairsData = await fetchPairsDataForDomain(supabaseClient, domain);
          domainRegex = await loadDomainRegex(supabaseClient, domain);
        }
      } catch (error) {
        console.warn(`Could not parse domain from URL: ${url}`);
        domain = undefined;
      }
      
      // Fetch page content using our crawl-page-html-enhanced function (with caching)
      const response = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/crawl-page-html-enhanced`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
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
      
      // Convert HTML to markdown
      pageContent = htmlToMarkdown(htmlResult.html);
      
      // Generate keywords for URL-only requests
      try {
        const keywordResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/extract-content-keywords`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
          },
          body: JSON.stringify({
            url: url,
            htmlContent: htmlResult.html,
            saveToDatabase: false
          })
        });
        
        if (keywordResponse.ok) {
          const keywordResult = await keywordResponse.json();
          
          if (keywordResult.success && Array.isArray(keywordResult.gscCompatibleKeywords)) {
            const validKeywords = [];
            for (const k of keywordResult.gscCompatibleKeywords) {
              if (await isValidKeyword(k.keyword, domainRegex)) {
                validKeywords.push(k);
                if (validKeywords.length >= 10) break;
              }
            }
            pageKeywords = validKeywords;
            console.log(`Generated ${pageKeywords.length} valid AI keywords for URL-only request after filtering`);
          }
        }
      } catch (aiError) {
        console.error(`Error generating AI keywords for URL: ${aiError.message}`);
      }
    }

    // Format keyword data if available
    let keywordsText = 'No keyword data available.';
    if (pageKeywords && pageKeywords.length > 0) {
      console.log(`[DEBUG] Starting keyword sorting with ${pageKeywords.length} keywords`);
      
      // STEP 1: First sort by impressions to get the most visible keywords
      let sortedByImpressions = [...pageKeywords].sort((a, b) => {
        // If one is AI-generated and the other isn't, prefer GSC data
        if (a.ai_generated && !b.ai_generated) return 1;
        if (!a.ai_generated && b.ai_generated) return -1;
        
        // Sort by impressions for GSC keywords
        if (a.impressions !== undefined && b.impressions !== undefined) {
          return b.impressions - a.impressions;
        }
        
        // If one has impressions and the other doesn't, prefer the one with impressions
        if (a.impressions !== undefined) return -1;
        if (b.impressions !== undefined) return 1;
        
        // For AI keywords, sort by relevance
        if (a.relevance && b.relevance) {
          return b.relevance - a.relevance;
        }
        
        return 0;
      });
      
      console.log(`[DEBUG] Top 5 keywords by impressions:`);
      sortedByImpressions.slice(0, 5).forEach((kw, i) => {
        console.log(`  ${i + 1}. "${kw.keyword}" - impressions: ${kw.impressions || 'N/A'}, clicks: ${kw.clicks || 0}`);
      });
      
      // STEP 2: Take the top 10-20 keywords by impressions (increase from 10 to capture more variety)
      const topKeywordsByImpressions = sortedByImpressions.slice(0, Math.min(20, sortedByImpressions.length));
      console.log(`[DEBUG] Selected top ${topKeywordsByImpressions.length} keywords by impressions`);
      
      // STEP 3: Resort those top keywords by clicks to prioritize engagement
      const prioritizedKeywords = topKeywordsByImpressions.sort((a, b) => {
        // First by data source (GSC over AI)
        if (a.ai_generated && !b.ai_generated) return 1;
        if (!a.ai_generated && b.ai_generated) return -1;
        
        // Sort by clicks for keywords that have click data
        if (a.clicks !== undefined && b.clicks !== undefined) {
          return b.clicks - a.clicks;
        }
        
        // If one has clicks and the other doesn't, prefer the one with clicks
        if (a.clicks !== undefined) return -1;
        if (b.clicks !== undefined) return 1;
        
        // Fallback to impressions
        if (a.impressions !== undefined && b.impressions !== undefined) {
          return b.impressions - a.impressions;
        }
        
        // Fallback to relevance for AI keywords
        if (a.relevance && b.relevance) {
          return b.relevance - a.relevance;
        }
        
        return 0;
      });
      
      // Take only the top 10 for the final output
      const finalKeywords = prioritizedKeywords.slice(0, 10);
      
      console.log(`[DEBUG] Final keyword order (top 10 after sorting by clicks):`);
      finalKeywords.forEach((kw, i) => {
        console.log(`  ${i + 1}. "${kw.keyword}" - clicks: ${kw.clicks || 0}, impressions: ${kw.impressions || 'N/A'}`);
      });
      
      console.log(`Processed keywords: Started with ${pageKeywords.length}, filtered to top ${topKeywordsByImpressions.length} by impressions, then sorted by clicks, showing top 10`);
      
      keywordsText = "IMPORTANT KEYWORDS TO INCLUDE (ordered by clicks and importance):\n";
      keywordsText += finalKeywords.map((kw, index) => {
        const source = kw.ai_generated ? 'AI prediction' : 'GSC data';
        const stats = kw.impressions ? 
          `clicks: ${kw.clicks}, impressions: ${kw.impressions}, position: ${typeof kw.position === 'number' ? kw.position.toFixed(1) : kw.position}` :
          kw.relevance ? `relevance: ${kw.relevance}/10, search intent: ${kw.search_intent || 'unknown'}` : 'no metrics available';
        
        return `${index + 1}. "${kw.keyword}" (${source}, ${stats})`;
      }).join('\n');
      
      // Add specific instructions for keyword usage
      keywordsText += "\n\nPlease ensure you:\n";
      keywordsText += "- Include the top 2-3 keywords in the title and H1\n";
      keywordsText += "- Include at least one primary keyword in the meta description\n"; 
      keywordsText += "- Use different keywords in the H2 than those used in the H1 (for more coverage)\n";
      keywordsText += "- Naturally integrate at least 3 keywords in the paragraph\n";
      keywordsText += "- Prioritize the keywords at the top of the list as they are most important\n";
    }

    const today = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }); // e.g. "May 16, 2025"

    // Extract domain from URL if not already set
    if (!domain && pageData?.url) {
      try {
        const urlObj = new URL(pageData.url);
        domain = urlObj.hostname;
        // Remove www if present
        if (domain.startsWith('www.')) {
          domain = domain.substring(4);
        }
      } catch (e) {
        console.warn(`Could not extract domain from URL: ${pageData?.url}`);
      }
    }

    if (!domain) {
      console.warn('No domain available for pairs lookup');
    }

    // Helper function to build brand information sections
    function buildBrandSection(pairsData: Record<string, any>): string {
      let brandSection = '';
      
      const brandName = pairsData.brand_name || pairsData.company_name;
      if (!brandName || Object.keys(pairsData).length === 0) {
        return ''; // Return empty if no brand data
      }

      // Only add sections where we have actual data (not placeholders)
      if (pairsData.company_synopsis) {
        brandSection += `\n\nHere is the company synopsis so you understand more about ${brandName}:\n${pairsData.company_synopsis}`;
      }
      
      if (pairsData.elevator_pitch) {
        brandSection += `\n\nHere's the ${brandName} elevator pitch:\n${pairsData.elevator_pitch}`;
      }
      
      if (pairsData.industry) {
        brandSection += `\n\nHere's the ${brandName} industry:\n${pairsData.industry}`;
      }
      
      if (pairsData.demographics_age) {
        brandSection += `\n\nHere's the ${brandName} client demographics age:\n${pairsData.demographics_age}`;
      }
      
      if (pairsData.market_focus) {
        brandSection += `\n\nHere's the ${brandName} market focus:\n${pairsData.market_focus}`;
      }
      
      if (pairsData.usp) {
        brandSection += `\n\nHere's the ${brandName} unique selling proposition (USP):\n${pairsData.usp}`;
      }
      
      if (pairsData.key_differentiators) {
        brandSection += `\n\nHere's the ${brandName} key differentiators:\n${pairsData.key_differentiators}`;
      }
      
      if (pairsData.avoid_topics) {
        brandSection += `\n\nHere's the topics that ${brandName} wish to avoid:\n${pairsData.avoid_topics}`;
        brandSection += `\n\nNEVER mention the above topics or phrases in your content. Avoid mentioning these words at all costs. Even if they are mentioned as a keyword suggestion or if the on-page content suggestions you should mention these words. These words have been specifically listed as words to never mention.`;
      }
      
      if (pairsData.competitor_names) {
        brandSection += `\n\nHere's the ${brandName} competitors brand names:\n${pairsData.competitor_names}`;
        brandSection += `\n\nNEVER mention the competitor domains in the content and NEVER use ANY information on competitor websites to build content. NEVER use ANY content on competitor websites to reference. NEVER use ANY content on competitor websites as quotes or tag lines.`;
      }
      
      if (pairsData.competitor_domains) {
        brandSection += `\n\nHere's the ${brandName} competitors domains:\n${pairsData.competitor_domains}`;
        brandSection += `\n\nNEVER mention the competitor domains in the content and NEVER use ANY information on competitor websites to build content. NEVER use ANY content on competitor websites to reference. NEVER use ANY content on competitor websites as quotes or tag lines.`;
      }
      
      if (pairsData.brand_story) {
        brandSection += `\n\nHere's the ${brandName} brand story:\n${pairsData.brand_story}`;
      }
      
      if (pairsData.brand_personality) {
        brandSection += `\n\nHere's the ${brandName} brand personality:\n${pairsData.brand_personality}`;
      }
      
      if (pairsData.trademark_words) {
        brandSection += `\n\nThe following terms should have the Trademark symbol added when needed in the content in this exact capitalization only. So if there is a mention of 'peanuts' ignore the need to add the Trademark, but if the word 'Peanuts' is needed in the content, add the Trademark. The Trademark symbol must be UTF-8 compatible.`;
        brandSection += `\n\nHere's the ${brandName} trademark words:\n${pairsData.trademark_words}`;

      }
      
      if (pairsData.registered_words) {
        brandSection += `\n\nThe following terms should have the Registered Trademark symbol added when needed in the content in this exact capitalization only. So if there is a mention of 'peanuts' ignore the need to add the Registered Trademark, but if the word 'Peanuts' is needed in the content, add the Registered Trademark. The Registered Trademark symbol must be UTF-8 compatible.`;
        brandSection += `\n\nHere's the ${brandName} registered words:\n${pairsData.registered_words}`;

      }
      
      
      if (pairsData.style_guide) {
        brandSection += `\n\nHere's the ${brandName} Global Editorial Style Guide:\n${pairsData.style_guide}`;
      }

      // Handle voice settings
      const voiceSettings = [];
      if (pairsData.first_person_voice) voiceSettings.push(pairsData.first_person_voice);
      if (pairsData.second_person_voice) voiceSettings.push(pairsData.second_person_voice);
      if (pairsData.third_person_voice) voiceSettings.push(pairsData.third_person_voice);
      
      if (voiceSettings.length > 0) {
        brandSection += `\n\nHere's the ${brandName} brand voice:\n${voiceSettings.join('\n')}`;
      }

      if (brandSection) {
        brandSection += `\n\nThe above is essential to remember when creating content to stay on brand.`;
      }

      return brandSection;
    }

    // Build brand section
    const brandInfoSection = buildBrandSection(pairsData);

    // Generate or get cached custom field schema if requested
    let customSchema: any = null;
    let customFieldsHash: string | null = null;
    
    if (includeCustomFields && customFieldsDescription) {
      console.log('Generating custom field schema...');
      try {
        customSchema = await generateOrGetCachedSchema(customFieldsDescription, cacheSchema);
        // Generate hash for tracking
        const encoder = new TextEncoder();
        const data = encoder.encode(customFieldsDescription.trim());
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        customFieldsHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        console.log(`Generated/retrieved custom schema with ${Object.keys(customSchema.fields).length} fields`);
      } catch (schemaError) {
        console.error('Failed to generate custom schema:', schemaError);
        // Continue without custom fields
        customSchema = null;
      }
    }

    const basePrompt = `VERY IMPORTANT: 
    Read all the instructions BEFORE doing ANYTHING. Think about all the instructions and THEN start doing the task(s).

    You are tasked with creating SEO-optimized elements for a webpage based on its URL, content, and keyword data. Your goal is to improve the page's search engine visibility 
    and user engagement.

    ⚠️ **Today's date is ${today}.**  
    - Every time you mention a date, treat ${today} as "now."  
    - If you encounter years such as 2022, 2023, 2024, or 2025 in the source material, **update** them so they make sense relative to today unless they are clearly historical facts.  
    - Make sure all time references, examples, and ranges are anchored in today's date.

    Here is the URL of the page:
    <url>
    ${pageData.url}
    </url>

    Here is the markdown content of the page:
    <markdown>
    ${pageContent}
    </markdown>

    Here are the special instructions for the ${pairsData.brand_name || pairsData.business_info}:
    <special_instructions>
    ${pairsData.special_ai_instructions}
    </special_instructions>

    Here is the keyword data for the page:
    <keywords>
    ${keywordsText}
    </keywords>

    If the keywords listed seem to be placeholders like ("keyword 1" or "keyword 2" or "keyword not found" or "null") then select your own keywords based on the content of the page, the URL of the 
    page and other information you know about the brand/company.

    ${brandInfoSection}

    Further, more detailed instructions:
    Carefully analyze the provided URL, markdown content, keyword data${brandInfoSection ? ' and brand information' : ''} to understand the main topic and purpose of the page${brandInfoSection ? ', as well as guidelines on writing style via brand information' : ''}. Pay attention to key themes, important keywords, and the overall message the page is trying to convey${brandInfoSection ? ' and interweave that information with the brand requirements when creating content' : ''}.

    Use the keywords in the title, meta description, H1, H2, H4, and paragraphs. Analyze the keywords and ensure they are used in the correct context. See the keyword data for more information.

    You must first make your selections from the keyword data (unless the keyword data appears to be placeholder information). Select a primary, secondary, and tertiary keyword. Keep in mind that 
    the keywords are already provided to you in preferential order, but you have the freedom to select any of the keywords if you feel the order provided wouldn't make sense because the terms are 
    too similar (plurals), don't truly reflect the page content's intent, are off-brand, are a form of a branded term or are somehow a competitor's brand name. That said, unless the keywords appear to 
    be placeholder keywords, then you MUST select from the LIST given. If there are no keywords given at all then you must select your own keywords the best you can and proceed. ONLY do this IF 
    there are no keywords provided. Then you must create the SEO elements based on the following instructions. IMPORTANT: Never select a branded term as a keyword. Never select a keyword outside 
    the list provided (unless the list provided are placeholder terms or there was no list provided).

    You must be strict with the character limits for the title (70 characters), meta description (155 characters), H1 heading (120 characters), H2 heading (120 characters), H4 heading (120 
    characters), Paragraph (60,000 characters) - do not exceed the character limitations.

    Based on your analysis, create the following elements:

    1. Title: Create an SEO-optimized title that is concise (70 characters) and accurately represents the page content. You MUST include at least one of the top 5 keywords from the provided keyword
    list or the keywords you selected because no keywords were provided or because you felt the keywords provided were placeholders. Choose the most relevant keywords, prioritizing those at the 
    top of the list (higher importance) but with flexibility to select others if necessary to meet other requirements. ${pairsData.brand_name || pairsData.business_info ? `Always end the title with " | ${pairsData.business_info || pairsData.brand_name}" unless that drives you over the 70-character limitation, then you should end the title with " | ${pairsData.also_known_as || pairsData.brand_short || pairsData.brand_name}".` : ''} You must stay within the character limitation of 70 characters${pairsData.brand_name ? ', including one of the above options as a title suffix' : ''}.

    2. Meta Description: Write a compelling meta description (155 characters) that summarizes the page content and entices a click when seen in search results. You MUST include at least two primary
    keywords from the provided keyword list or the keywords you selected because no keywords were provided or because you felt the keywords provided were placeholders. The description should 
    entice users to click through to the page by highlighting a benefit or addressing a pain point that is solved by the content of the page. ${pairsData.usp ? 'Also consider the USP listed above and the other branding information from above when creating a compelling meta description.' : ''}

    3. H1 Heading: Craft a primary heading that clearly states the main topic of the page. You MUST include at least one of the top-provided keywords from the keyword list (or the keywords you 
    selected because no keywords were provided or because you felt the keywords provided were placeholders) -- preferably the most important keyword should be selected. The H1 should be similar to 
    the title but can be longer and more descriptive. Relevance to the page's content is weighted the heaviest here, but requirements still state to stay within the options provided in the keyword 
    list. If you feel there is a complete disconnect between the keywords provided or selected by you for the previously mentioned reasons, then ignore the keywords completely and create a proper 
    H1 heading that works with the page's content. It's vital that you only utilize this option in extreme cases. DO NOT CREATE AN H1 HEADING THAT INCLUDES CONTENT THAT MAY BECOME DATED (SUCH AS 
    TEMPORARY SALES OR PROMOTIONS). EXAMPLE DO NOT DO THE FOLLOWING:
    50% Off All Kids Costumes
    BOGO 50th Birthday Decorations
    27 Backyard Decorations You'll Love
    This Year's Super Bowl Champions Party Plates

    4. H2 Heading: Create a secondary heading that acts as a page-level subheading. This should be broader than the H1 and set up the category or section-level context. To expand keyword coverage, 
    you MUST use different keywords from those used in the H1. Choose from the keyword list or select from those you had to select because no keywords were provided or because they were placeholder
    keywords, focusing on those that complement the primary keywords.

    DO NOT CREATE AN H2 HEADING THAT INCLUDES CONTENT THAT MAY BECOME DATED (SUCH AS TEMPORARY SALES OR PROMOTIONS). EXAMPLE DO NOT DO THE FOLLOWING:
    50% Off All Kids Costumes
    BOGO 50th Birthday Decorations
    27 Backyard Decorations You'll Love
    This Year's Super Bowl Champions Party Plates

    5. H4 Heading: Create a sectional heading directly related to the paragraph's content, which will be placed directly below this H4 heading on the page. This heading should be more specific and 
    focused on the paragraph topic or paragraph text. It should be more specific than the H2 and directly introduce the paragraph's content.

    6. Paragraph: Write five paragraphs (with three sentences each) that provide valuable information related to the H4 heading above it. These paragraphs should naturally integrate the primary 
    keyword, secondary keyword and at least two additional keywords from the provided list. If no keywords are supplied or the keywords appear to be placeholders, assume keywords and use them 
    accordingly. Ensure that whichever keywords are used fit contextually and provide meaningful value to the reader. Do not keyword stuff. The content should be about 2250 characters in length.

    When creating the six elements above, keep the following guidelines in mind:
    - Ensure all elements are cohesive and relate to the main topic of the page
    - Use important keywords naturally and avoid keyword stuffing
    - Prioritize keywords with higher clicks, impressions, and CTR (which the keywords should already be provided in that order)
    - Make the content informative, engaging, and valuable to the reader${brandInfoSection ? ' but also keep in mind the specific brand details provided above when creating the tone of the content' : ''}
    - Adhere to the specified character limits for each of the six elements
    - Make sure the H2 and H4 have a clear hierarchical relationship
    - Never use the URL (or portion of the URL) in the title, meta description, H1, H2, or H4 or paragraph
    - Never select the URL (or portion of the URL) as a keyword

    

    Format your final output as follows, You must include all the elements:

    <seo_elements>
    <primary_keyword>Selected primary keyword here</primary_keyword>
    <secondary_keyword>Selected secondary keyword here</secondary_keyword>
    <tertiary_keyword>Selected tertiary keyword here</tertiary_keyword>
    <title>Your SEO-optimized title here</title>
    <meta_description>Your meta description here</meta_description>
    <h1>Your H1 heading here</h1>
    <h2>Your H2 heading here</h2>
    <h4>Your H4 heading here</h4>
    <paragraph>Your paragraph here</paragraph>
    </seo_elements>

    Your final output should contain only the SEO elements within the specified tags. Do not include any explanations, additional text, or the keyword data outside of these tags.`;
    
    // Use enhanced prompt if custom fields are requested
    const prompt = customSchema 
      ? buildEnhancedPrompt(basePrompt, customSchema, pageContent, pageKeywords || [])
      : basePrompt;

    // Call Groq GPT-OSS-120B API with logging
    console.log(`Calling Groq GPT-OSS-120B API with logging for ${url || `pageId: ${pageId}`}`);
    
    // Prepare metadata for logging
    const metadata = {
      pageId: pageId || null,
      url: pageData.url,
      modelName,
      keywordCount: pageKeywords?.length || 0,
      hasPairsData: Object.keys(pairsData).length > 0,
      hasCustomFields: !!customSchema,
      customFieldCount: customSchema ? Object.keys(customSchema.fields).length : 0,
      reasoningEffort: 'medium'
    };

    // Call Groq GPT-OSS-120B with logging
    const { response: modelResponse, thinking } = await callGPT120OSSWithLogging(
      FUNCTION_NAME, 
      prompt, 
      domain, 
      metadata
    );

    // For compatibility with the rest of the function
    const seoElements = {
      content: modelResponse,
      reasoning: thinking
    };
    
    // Extract the SEO elements from Groq's response
    const seoData = extractSeoElements(seoElements);
    
    // Extract custom SEO data if schema exists
    let customSeoData: any = null;
    if (customSchema) {
      customSeoData = extractCustomSeoData(modelResponse);
      if (customSeoData) {
        console.log(`Extracted custom SEO data with ${Object.keys(customSeoData).length} fields`);
        // Validate custom fields against schema
        const validation = validateCustomFields(customSeoData, customSchema);
        if (!validation.valid) {
          console.warn('Custom field validation warnings:', validation.errors);
        }
      } else {
        console.warn('No custom SEO data extracted despite schema being present');
      }
    }
    
    // Store the results in the database if pageId is provided
    if (pageId) {
      console.log(`Storing SEO elements for page ${pageId}`);
      
      // Prepare keywords data for storage
      let keywordsJson = null;
      if (pageKeywords && pageKeywords.length > 0) {
        keywordsJson = JSON.stringify(pageKeywords);
        console.log(`Storing ${pageKeywords.length} keywords for page ${pageId}`);
      }
      
      try {
        // First get the page URL
        const { data: pageData, error: pageError } = await supabaseClient
          .from('pages')
          .select('url')
          .eq('id', pageId)
          .single();
          
        if (pageError) {
          console.error(`Error getting page URL: ${pageError.message}`);
          return;
        }
        
        if (!pageData || !pageData.url) {
          console.error(`No URL found for page ${pageId}`);
          return;
        }
        
        const pageUrl = pageData.url;
        console.log(`Page URL: ${pageUrl}`);
        
        // Simple direct insert - no RPC, no upsert
        console.log(`Inserting SEO elements for ${pageId}`);
        
        // Check if any of the SEO elements were successfully extracted
        const hasValidElements = seoData.title || seoData.metaDescription || seoData.h1 || seoData.h2 || seoData.h4 || seoData.paragraph;
        
        if (!hasValidElements) {
          console.log("No valid SEO elements were extracted. Retrying with different parameters...");
          
          // Use a more focused prompt for the retry
          const retryPrompt = basePrompt;
        
          // Try with more focused instructions
          console.log("First retry with different model parameters...");
          
          // Call Groq with logging for retry
          const { response: retryModelResponse, thinking: retryThinking } = await callGPT120OSSWithLogging(
            FUNCTION_NAME + '_retry1', 
            retryPrompt, 
            domain, 
            { ...metadata, retry: 1 }
          );
          
          const firstRetry = {
            content: retryModelResponse,
            reasoning: retryThinking
          };
          let retryData = extractSeoElements(firstRetry);
          
          if (!retryData.title || !retryData.h1 || !retryData.h4) {
            console.log("Second retry with simplified prompt...");
            const simplifiedPrompt = `You are an SEO expert tasked with creating optimized elements for a webpage based on its URL and available keywords.

URL: ${pageData.url}

${keywordsText}

First, select the 3 most important keywords to focus on:
1. Primary Keyword: Choose the most important keyword with high clicks that best represents the main topic
2. Secondary Keyword: Choose a different keyword that complements the primary keyword and adds context
3. Tertiary Keyword: Choose a third keyword that adds additional value or represents a subtopic

Then create the following SEO elements, making sure to incorporate these keywords appropriately:

1. Title: A concise (50-60 characters) SEO-optimized title that accurately represents the page content and includes the primary keyword.

2. Meta Description: A compelling meta description (150-160 characters) that summarizes the page content and includes the primary and possibly secondary keywords.

3. H1 Heading: A primary heading that clearly states the main topic of the page and incorporates the primary keyword.

4. H2 Heading: A secondary heading that acts as a page-level subheading. This should be a broader category or section level heading that complements the H1 and uses the secondary keyword.

5. H4 Heading: A sectional heading that directly relates to the paragraphs content below it. This should be specific and focused on the paragraph topic, possibly using the tertiary keyword.

6. Paragraph: 3-5 paragraphs (with 3-4 sentences each) that provide valuable information related to the H4 heading above it and naturally incorporate all three keywords throughout the text.

IMPORTANT: Format your response EXACTLY like this, You must include all the elements:
<seo_elements>
<primary_keyword>Selected primary keyword here</primary_keyword>
<secondary_keyword>Selected secondary keyword here</secondary_keyword>
<tertiary_keyword>Selected tertiary keyword here</tertiary_keyword>
<title>Your title here</title>
<meta_description>Your meta description here</meta_description>
<h1>Your H1 heading here</h1>
<h2>Your H2 heading here</h2>
<h4>Your H4 heading here</h4>
<paragraph>Your paragraph here</paragraph>
</seo_elements>`;
            
            // Call Groq with logging for second retry
            const { response: retry2ModelResponse, thinking: retry2Thinking } = await callGPT120OSSWithLogging(
              FUNCTION_NAME + '_retry2', 
              simplifiedPrompt, 
              domain, 
              { ...metadata, retry: 2 }
            );
            
            const secondRetry = {
              content: retry2ModelResponse,
              reasoning: retry2Thinking
            };
            retryData = extractSeoElements(secondRetry);
            
            if (!retryData.title || !retryData.h1 || !retryData.h4) {
              console.log("Final retry with more direct instructions...");
              
              // Call Groq with logging for final retry
              const { response: finalRetryModelResponse, thinking: finalRetryThinking } = await callGPT120OSSWithLogging(
                FUNCTION_NAME + '_retry_final', 
                simplifiedPrompt, 
                domain, 
                { ...metadata, retry: 3, final_attempt: true }
              );
              
              const finalRetry = {
                content: finalRetryModelResponse,
                reasoning: finalRetryThinking
              };
              const finalRetryData = extractSeoElements(finalRetry);
              
              // Use any valid elements from the retries
              if (finalRetryData.title) retryData.title = finalRetryData.title;
              if (finalRetryData.metaDescription) retryData.metaDescription = finalRetryData.metaDescription;
              if (finalRetryData.h1) retryData.h1 = finalRetryData.h1;
              if (finalRetryData.h2) retryData.h2 = finalRetryData.h2;
              if (finalRetryData.h4) retryData.h4 = finalRetryData.h4;
              if (finalRetryData.paragraph) retryData.paragraph = finalRetryData.paragraph;
              if (finalRetryData.primaryKeyword) retryData.primaryKeyword = finalRetryData.primaryKeyword;
              if (finalRetryData.secondaryKeyword) retryData.secondaryKeyword = finalRetryData.secondaryKeyword;
              if (finalRetryData.tertiaryKeyword) retryData.tertiaryKeyword = finalRetryData.tertiaryKeyword;
            }
          }
          
          // Merge any successful retry results with our data
          if (retryData.title) seoData.title = retryData.title;
          if (retryData.metaDescription) seoData.metaDescription = retryData.metaDescription;
          if (retryData.h1) seoData.h1 = retryData.h1;
          if (retryData.h2) seoData.h2 = retryData.h2;
          if (retryData.h4) seoData.h4 = retryData.h4;
          if (retryData.paragraph) seoData.paragraph = retryData.paragraph;
          if (retryData.primaryKeyword) seoData.primaryKeyword = retryData.primaryKeyword;
          if (retryData.secondaryKeyword) seoData.secondaryKeyword = retryData.secondaryKeyword;
          if (retryData.tertiaryKeyword) seoData.tertiaryKeyword = retryData.tertiaryKeyword;
          
          // Check if we got valid elements after retries
          const hasValidElementsAfterRetry = seoData.title || seoData.metaDescription || seoData.h1 || seoData.h2 || seoData.h4 || seoData.paragraph;
          
          if (hasValidElementsAfterRetry) {
            console.log("Successfully generated elements after Groq GPT-OSS-120B retries");
          } else {
            console.error("Failed to generate valid elements even after multiple Groq GPT-OSS-120B retries");
            throw new Error("Failed to generate SEO elements after multiple retries");
          }
        }
        
        const title = seoData.title;
        const metaDescription = seoData.metaDescription;
        const h1 = seoData.h1;
        const h2 = seoData.h2;
        const h4 = seoData.h4;
        const paragraph = seoData.paragraph;
        const primaryKeyword = seoData.primaryKeyword;
        const secondaryKeyword = seoData.secondaryKeyword;
        const tertiaryKeyword = seoData.tertiaryKeyword;
        
        console.log(`Data to insert: title=${title?.substring(0, 20)}..., meta=${metaDescription?.substring(0, 20)}...`);
        
        // Before storing, fetch fresh GSC data
        const gscData = await fetchAndAggregateGscData(supabaseClient, pageUrl);

        // Also calculate from existing keywords as fallback
        const keywordMetrics = calculateGscMetricsFromKeywords(pageKeywords);

        // Use fresh GSC data if available, otherwise use keyword metrics
        const finalGscData = {
          gsc_impressions: gscData.gsc_impressions !== null ? gscData.gsc_impressions : keywordMetrics.gsc_impressions,
          gsc_clicks: gscData.gsc_clicks !== null ? gscData.gsc_clicks : keywordMetrics.gsc_clicks,
          gsc_ctr: gscData.gsc_ctr !== null ? gscData.gsc_ctr : keywordMetrics.gsc_ctr,
          gsc_average_rank: gscData.gsc_average_rank !== null ? gscData.gsc_average_rank : keywordMetrics.gsc_average_rank,
          gsc_data_date: gscData.gsc_data_date || new Date().toISOString().split('T')[0],
          has_gsc_data: gscData.has_gsc_data || keywordMetrics.has_gsc_data,
          is_indexed: gscData.is_indexed
        };

        // Log GSC data status
        console.log(`GSC Data Status: ${finalGscData.has_gsc_data ? 'Found' : 'Not Found'}, Indexed: ${finalGscData.is_indexed}, Impressions: ${finalGscData.gsc_impressions || 0}`);
        
        // Fetch indexation status (with timeout to prevent blocking)
        const indexationData = await Promise.race([
          checkIndexationStatus(pageUrl),
          new Promise<any>((resolve) => setTimeout(() => resolve({
            indexation_status: null,
            indexation_emoji: null,
            indexation_details: null,
            indexation_last_crawl_time: null,
            indexation_page_fetch_state: null,
            indexation_google_canonical: null,
            indexation_user_canonical: null,
            indexation_sitemap_presence: null,
            indexation_referring_urls: null,
            indexation_crawled_as: null,
            indexation_robots_txt_state: null,
            indexation_checked_at: new Date().toISOString()
          }), 5000)) // 5 second timeout
        ]);
        
        console.log(`Indexation Status for ${pageUrl}: ${indexationData.indexation_status} ${indexationData.indexation_emoji || ''}`);
        
        // First check if a record already exists using a more reliable query
        const { data: existingRecords, error: checkError } = await supabaseClient
          .from('page_seo_recommendations')
          .select('id')
          .eq('page_id', pageId);
        
        if (checkError) {
          console.error(`Error checking for existing record: ${checkError.message}`);
        }
        
        if (existingRecords && existingRecords.length > 0) {
          // Update the first record if multiple exist
          const recordId = existingRecords[0].id;
          console.log(`Updating existing record ${recordId} for page ${pageId}`);
          
          const updateData: any = {
            title,
            meta_description: metaDescription,
            h1,
            h2,
            h4,
            paragraph,
            primary_keyword: primaryKeyword,
            secondary_keyword: secondaryKeyword,
            tertiary_keyword: tertiaryKeyword,
            thinking_log: seoElements.reasoning || '',
            keywords: keywordsJson ? JSON.parse(keywordsJson) : null,
            // Always include GSC fields to prevent overwriting with NULL
            gsc_impressions: finalGscData.gsc_impressions,
            gsc_clicks: finalGscData.gsc_clicks,
            gsc_ctr: finalGscData.gsc_ctr,
            gsc_average_rank: finalGscData.gsc_average_rank,
            gsc_data_date: finalGscData.gsc_data_date,
            has_gsc_data: finalGscData.has_gsc_data,
            is_indexed: finalGscData.is_indexed,
            // Indexation fields
            indexation_status: indexationData.indexation_status,
            indexation_emoji: indexationData.indexation_emoji,
            indexation_details: indexationData.indexation_details,
            indexation_last_crawl_time: indexationData.indexation_last_crawl_time,
            indexation_page_fetch_state: indexationData.indexation_page_fetch_state,
            indexation_google_canonical: indexationData.indexation_google_canonical,
            indexation_user_canonical: indexationData.indexation_user_canonical,
            indexation_sitemap_presence: indexationData.indexation_sitemap_presence,
            indexation_referring_urls: indexationData.indexation_referring_urls,
            indexation_crawled_as: indexationData.indexation_crawled_as,
            indexation_robots_txt_state: indexationData.indexation_robots_txt_state,
            indexation_checked_at: indexationData.indexation_checked_at,
            updated_at: new Date().toISOString()
          };

          // Add custom fields if we have them
          if (customSeoData) {
            updateData.custom_seo_data = customSeoData;
            updateData.custom_schema = customSchema;
            updateData.custom_fields_hash = customFieldsHash;
            updateData.generation_type = 'enhanced';
          }

          const { error: updateError } = await supabaseClient
            .from('page_seo_recommendations')
            .update(updateData)
            .eq('id', recordId);
            
          if (updateError) {
            console.error(`Update error: ${updateError.message}`);
          } else {
            console.log(`Successfully updated record for ${pageId}`);
          }
        } else {
          // Insert new record
          console.log(`Creating new record for ${pageId}`);
          
          const insertData: any = {
            page_id: pageId,
            url: pageUrl,
            title,
            meta_description: metaDescription,
            h1,
            h2,
            h4,
            paragraph,
            primary_keyword: primaryKeyword,
            secondary_keyword: secondaryKeyword,
            tertiary_keyword: tertiaryKeyword,
            thinking_log: seoElements.reasoning || '',
            keywords: keywordsJson ? JSON.parse(keywordsJson) : null,
            // Include GSC fields in insert
            gsc_impressions: finalGscData.gsc_impressions,
            gsc_clicks: finalGscData.gsc_clicks,
            gsc_ctr: finalGscData.gsc_ctr,
            gsc_average_rank: finalGscData.gsc_average_rank,
            gsc_data_date: finalGscData.gsc_data_date,
            has_gsc_data: finalGscData.has_gsc_data,
            is_indexed: finalGscData.is_indexed,
            // Indexation fields
            indexation_status: indexationData.indexation_status,
            indexation_emoji: indexationData.indexation_emoji,
            indexation_details: indexationData.indexation_details,
            indexation_last_crawl_time: indexationData.indexation_last_crawl_time,
            indexation_page_fetch_state: indexationData.indexation_page_fetch_state,
            indexation_google_canonical: indexationData.indexation_google_canonical,
            indexation_user_canonical: indexationData.indexation_user_canonical,
            indexation_sitemap_presence: indexationData.indexation_sitemap_presence,
            indexation_referring_urls: indexationData.indexation_referring_urls,
            indexation_crawled_as: indexationData.indexation_crawled_as,
            indexation_robots_txt_state: indexationData.indexation_robots_txt_state,
            indexation_checked_at: indexationData.indexation_checked_at,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          };

          // Add custom fields if we have them
          if (customSeoData) {
            insertData.custom_seo_data = customSeoData;
            insertData.custom_schema = customSchema;
            insertData.custom_fields_hash = customFieldsHash;
            insertData.generation_type = 'enhanced';
          }

          const { error: insertError } = await supabaseClient
            .from('page_seo_recommendations')
            .insert(insertData);
            
          if (insertError) {
            console.error(`Insert error: ${insertError.message}`);
            
            // If insert fails, try a different approach - delete then insert
            if (insertError.message.includes('violates unique constraint')) {
              console.log('Insert failed due to constraint violation. Trying delete + insert approach...');
              
              // Delete any existing records
              const { error: deleteError } = await supabaseClient
                .from('page_seo_recommendations')
                .delete()
                .eq('page_id', pageId);
                
              if (deleteError) {
                console.error(`Delete error: ${deleteError.message}`);
              } else {
                // Try insert again
                const { error: reinsertError } = await supabaseClient
                  .from('page_seo_recommendations')
                  .insert(insertData);
                  
                if (reinsertError) {
                  console.error(`Re-insert error: ${reinsertError.message}`);
                } else {
                  console.log(`Successfully inserted record for ${pageId} after delete`);
                }
              }
            }
          } else {
            console.log(`Successfully inserted record for ${pageId}`);
          }
        }
      } catch (err) {
        console.error(`Error in database operations: ${err.message}`);
      }
    }
    
    // Return success response
    return new Response(
      JSON.stringify({
        success: true,
        url: pageData.url,
        pageId,
        seoElements: seoData,
        customSeoData: customSeoData,
        customSchema: customSchema,
        priorityKeywords: {
          primary: seoData.primaryKeyword || null,
          secondary: seoData.secondaryKeyword || null,
          tertiary: seoData.tertiaryKeyword || null
        },
        reasoning: seoElements.reasoning,
        pairsDataLoaded: Object.keys(pairsData).length > 0,
        enhancedGeneration: !!customSeoData
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

// Function to convert HTML to Markdown
function htmlToMarkdown(html: string): string {
  // Handle null or undefined input
  if (!html) {
    console.warn('htmlToMarkdown received null or undefined input');
    return '';
  }
  
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
    
    // Convert images
    .replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*>/gi, '![$2]($1)')
    .replace(/<img[^>]*alt="([^"]*)"[^>]*src="([^"]*)"[^>]*>/gi, '![$1]($2)')
    .replace(/<img[^>]*src="([^"]*)"[^>]*>/gi, '![]($1)')
    
    // Convert strong/bold and em/italic text
    .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**')
    .replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**')
    .replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*')
    .replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, '*$1*')
    
    // Remove all other HTML tags
    .replace(/<[^>]*>/g, '')
    
    // Fix multiple consecutive line breaks
    .replace(/\n\s*\n\s*\n/g, '\n\n');
    
  // HTML entities are already decoded by cleanText, but decode any remaining ones
  markdown = decodeHtmlEntities(markdown);
  
  // Truncate if too long (keep under 50K characters)
  if (markdown.length > 50000) {
    markdown = markdown.substring(0, 50000) + "\n\n[Content truncated due to length...]";
  }
  
  return markdown;
}

// Function to extract SEO elements from Groq's response
function extractSeoElements(groqResponse: { content: string, reasoning?: string }) {
  console.log('Extracting SEO elements from Groq GPT-OSS-120B response');

  // Log content information to help with debugging
  const contentStr = groqResponse.content;
  console.log(`Content string length: ${contentStr.length}`);
  if (contentStr.length > 0) {
    console.log(`Content preview: ${contentStr.substring(0, 100)}...`);
  }
  
  // First try to extract from seo_elements block
  let seoBlock = '';
  const seoElementsRegex = /<seo_elements>([\s\S]*?)<\/seo_elements>/s;
  const seoElementsMatch = contentStr.match(seoElementsRegex);
  
  if (seoElementsMatch && seoElementsMatch[1]) {
    seoBlock = seoElementsMatch[1];
    console.log('Found seo_elements block');
  } else {
    // Try again with the entire content as some responses might have the tags
    // but not be properly nested due to streaming collection
    const fullMatch = contentStr.match(seoElementsRegex);
    if (fullMatch && fullMatch[1]) {
      seoBlock = fullMatch[1];
      console.log('Found seo_elements block in full content');
    } else {
      seoBlock = contentStr;
      console.log('No seo_elements block found, using full content');
    }
  }
  
  // Define regular expressions for extracting the SEO elements
  const titleRegex = /<title>([\s\S]*?)<\/title>/s;
  const metaDescriptionRegex = /<meta_description>([\s\S]*?)<\/meta_description>/s;
  const h1Regex = /<h1>([\s\S]*?)<\/h1>/s;
  const h2Regex = /<h2>([\s\S]*?)<\/h2>/s;
  const h4Regex = /<h4>([\s\S]*?)<\/h4>/s;
  const paragraphRegex = /<paragraph>([\s\S]*?)<\/paragraph>/s;
  
  // Define regex for priority keywords
  const primaryKeywordRegex = /<primary_keyword>([\s\S]*?)<\/primary_keyword>/s;
  const secondaryKeywordRegex = /<secondary_keyword>([\s\S]*?)<\/secondary_keyword>/s;
  const tertiaryKeywordRegex = /<tertiary_keyword>([\s\S]*?)<\/tertiary_keyword>/s;
  
  // First try to extract from the seo block
  let titleMatch = seoBlock.match(titleRegex);
  let metaDescriptionMatch = seoBlock.match(metaDescriptionRegex);
  let h1Match = seoBlock.match(h1Regex);
  let h2Match = seoBlock.match(h2Regex);
  let h4Match = seoBlock.match(h4Regex);
  let paragraphMatch = seoBlock.match(paragraphRegex);
  let primaryKeywordMatch = seoBlock.match(primaryKeywordRegex);
  let secondaryKeywordMatch = seoBlock.match(secondaryKeywordRegex);
  let tertiaryKeywordMatch = seoBlock.match(tertiaryKeywordRegex);
  
  // If not found in seo block, try the entire content string
  if (!titleMatch) titleMatch = contentStr.match(titleRegex);
  if (!metaDescriptionMatch) metaDescriptionMatch = contentStr.match(metaDescriptionRegex);
  if (!h1Match) h1Match = contentStr.match(h1Regex);
  if (!h2Match) h2Match = contentStr.match(h2Regex);
  if (!h4Match) h4Match = contentStr.match(h4Regex);
  if (!paragraphMatch) paragraphMatch = contentStr.match(paragraphRegex);
  if (!primaryKeywordMatch) primaryKeywordMatch = contentStr.match(primaryKeywordRegex);
  if (!secondaryKeywordMatch) secondaryKeywordMatch = contentStr.match(secondaryKeywordRegex);
  if (!tertiaryKeywordMatch) tertiaryKeywordMatch = contentStr.match(tertiaryKeywordRegex);
  
  // Log extraction results
  console.log(`Title found: ${titleMatch !== null}`);
  console.log(`Meta description found: ${metaDescriptionMatch !== null}`);
  console.log(`H1 found: ${h1Match !== null}`);
  console.log(`H2 found: ${h2Match !== null}`);
  console.log(`H4 found: ${h4Match !== null}`);
  console.log(`Paragraph found: ${paragraphMatch !== null}`);
  console.log(`Primary keyword found: ${primaryKeywordMatch !== null}`);
  console.log(`Secondary keyword found: ${secondaryKeywordMatch !== null}`);
  console.log(`Tertiary keyword found: ${tertiaryKeywordMatch !== null}`);
  
  // Construct result object and clean all extracted text
  const result = {
    title: titleMatch ? cleanText(titleMatch[1].trim()) : '',
    metaDescription: metaDescriptionMatch ? cleanText(metaDescriptionMatch[1].trim()) : '',
    h1: h1Match ? cleanText(h1Match[1].trim()) : '',
    h2: h2Match ? cleanText(h2Match[1].trim()) : '',
    h4: h4Match ? cleanText(h4Match[1].trim()) : '',
    paragraph: paragraphMatch ? cleanText(paragraphMatch[1].trim()) : '',
    primaryKeyword: primaryKeywordMatch ? cleanText(primaryKeywordMatch[1].trim()) : '',
    secondaryKeyword: secondaryKeywordMatch ? cleanText(secondaryKeywordMatch[1].trim()) : '',
    tertiaryKeyword: tertiaryKeywordMatch ? cleanText(tertiaryKeywordMatch[1].trim()) : ''
  };
  
  // Check for empty fields and log warnings
  const emptyFields = Object.entries(result)
    .filter(([_, value]) => !value)
    .map(([key, _]) => key);
    
  if (emptyFields.length > 0) {
    console.warn(`Warning: Empty fields detected: ${emptyFields.join(', ')}`);
    
    // As a fallback for really bad cases where no tags are found,
    // try to extract based on structural clues in the text
    if (emptyFields.length >= 5 && contentStr.length > 100) {
      console.log("Attempting last-resort extraction based on content structure...");
      
      const lines = contentStr.split('\n').filter(line => line.trim().length > 0);
      if (lines.length >= 6) {
        // Simple heuristic: first 6 non-empty lines might be the elements we want
        result.title = result.title || lines[0].trim();
        result.metaDescription = result.metaDescription || lines[1].trim();
        result.h1 = result.h1 || lines[2].trim();
        result.h2 = result.h2 || lines[3].trim();
        result.h4 = result.h4 || lines[4].trim();
        result.paragraph = result.paragraph || lines[5].trim();
        
        console.log("Applied fallback extraction based on line structure");
      } else if (lines.length >= 5) {
        // Handle case when only 5 lines are available
        result.title = result.title || lines[0].trim();
        result.metaDescription = result.metaDescription || lines[1].trim();
        result.h1 = result.h1 || lines[2].trim();
        result.h2 = result.h2 || lines[3].trim();
        result.h4 = "Key Information"; // Default value
        result.paragraph = result.paragraph || lines[4].trim();
        
        console.log("Applied fallback extraction based on 5-line structure with default H4");
      }
    }
  }
  
  return result;
}