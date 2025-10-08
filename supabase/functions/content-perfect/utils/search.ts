// supabase/functions/content-perfect/utils/search.ts
import { logError, retryWithBackoff } from '../../utils/error-handling.ts';

// Constants for search and retries
const SEARCH_MAX_RETRIES = 3;
const SEARCH_RETRY_DELAY = 2000; // ms
const MAX_SOURCES_PER_SUBSECTION = 3;

// Document and binary file extensions to filter out
const DOCUMENT_EXTENSIONS = [
  '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx',
  '.zip', '.rar', '.tar', '.gz', '.7z', '.exe', '.dmg'
];

/**
 * Checks if a URL is to a binary/document file that we should not process
 */
function isBinaryOrDocumentUrl(url: string): boolean {
  const lowerUrl = url.toLowerCase();
  return DOCUMENT_EXTENSIONS.some(ext => lowerUrl.endsWith(ext));
}

/**
 * Check if a URL is from a competitor domain (should be excluded)
 */
function isCompetitor(url: string, clientDomain: string, competitors: string[]): boolean {
  try {
    if (!url || !clientDomain) return false;
    
    // Extract domain from URL
    const urlObj = new URL(url);
    const domain = urlObj.hostname.replace(/^www\./, '');
    
    // Extract client domain without www
    const client = clientDomain.replace(/^www\./, '').trim();
    
    // Check if the domain is in the competitors list
    const isInCompetitorsList = competitors.some(comp => 
      domain.includes(comp.replace(/^www\./, '').trim())
    );
    
    // Check if it's the same domain or a direct competitor
    return domain === client || isInCompetitorsList;
  } catch (error) {
    console.error(`Error in isCompetitor for ${url}:`, error);
    return false;
  }
}

/**
 * Check if a source is valid (not restricted domain)
 */
function isValidSource(url: string): boolean {
  try {
    if (!url) return false;
    
    // Parse URL to get domain
    const urlObj = new URL(url);
    const domain = urlObj.hostname.replace(/^www\./, '');
    
    // Known restricted domains
    const restrictedDomains = [
      'facebook.com', 'twitter.com', 'instagram.com', 'pinterest.com',
      'reddit.com', 'quora.com', 'youtube.com', 'tiktok.com',
      'linkedin.com', 'glassdoor.com', 'indeed.com'
    ];
    
    return !restrictedDomains.some(restricted => domain.includes(restricted));
  } catch (error) {
    console.error(`Error validating source ${url}:`, error);
    return false;
  }
}

/**
 * Get search results for a given term using ScaleSERP API
 * @param searchTerm The search term to query
 * @returns Array of search results or null if error
 */
export async function getSearchResults(searchTerm: string) {
  // Clean the search term
  searchTerm = searchTerm.replace(/"/g, '').replace(/'/g, '').trim();
  
  const apiKey = Deno.env.get('SCALESERP_API_KEY');
  if (!apiKey) {
    console.warn("Warning: SCALESERP_API_KEY not set");
    return null;
  }
  
  return await retryWithBackoff(async () => {
    const params = {
      'api_key': apiKey,
      'q': searchTerm,
      'gl': 'us',
      'google_domain': 'google.com',
      'num': 20  // Request more results
    };
    
    console.log(`Fetching search results for term: ${searchTerm}`);
    
    const url = new URL('https://api.scaleserp.com/search');
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.append(key, value.toString());
    });
    
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    
    if (!response.ok) {
      throw new Error(`ScaleSERP API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    
    if (!data.organic_results || !Array.isArray(data.organic_results)) {
      console.log(`No organic_results in response. Response data: ${JSON.stringify(data, null, 2)}`);
      return [];
    }
    
    console.log(`Successfully got ${data.organic_results.length} results`);
    
    // Filter out restricted domains and binary/document files
    const filteredResults = data.organic_results
      .filter(result => 
        result.link && 
        isValidSource(result.link) && 
        !isBinaryOrDocumentUrl(result.link)
      );
    
    console.log(`After filtering restricted domains and binary files: ${filteredResults.length} results`);
    
    return filteredResults;
  }, SEARCH_MAX_RETRIES, SEARCH_RETRY_DELAY);
}

/**
 * Select the most relevant URLs from search results
 * @param results Search results from ScaleSERP
 * @param context The context (topic + section title + subsection)
 * @param maxUrls Maximum number of URLs to return
 * @param clientSynopsis Client domain information
 * @returns Array of selected URLs
 */
export async function selectRelevantUrls(
  results: any[], 
  context: string, 
  maxUrls: number = 3,
  clientSynopsis: any = {}
) {
  if (!results || results.length === 0) {
    return [];
  }
  
  // If we have enough results, use AI to select relevant ones
  // For this example, just select top results
  const selectedUrls = results.slice(0, maxUrls);
  
  console.log(`Selected ${selectedUrls.length} relevant URLs from ${results.length} results`);
  return selectedUrls;
}

/**
 * Get article text and citation information from a URL
 * @param url The URL to fetch
 * @returns Object with text and citation
 */
export async function getArticleTextAndCitation(url: string): Promise<{ text: string; citation: any }> {
  try {
    console.log(`Fetching content from URL: ${url}`);
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`);
    }
    
    const html = await response.text();
    
    // Use a simplified approach for readability
    // In production, use a proper readability library
    const doc = new DOMParser().parseFromString(html, 'text/html');
    
    // Extract title
    const title = doc.querySelector('title')?.textContent || '';
    
    // Extract main content (basic implementation)
    let textContent = '';
    const mainContent = doc.querySelector('main') || doc.querySelector('article') || doc.body;
    if (mainContent) {
      textContent = mainContent.textContent || '';
      textContent = textContent
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 10000); // Limit content length
    }
    
    // Create citation
    const urlObj = new URL(url);
    const domain = urlObj.hostname.replace(/^www\./, '');
    const citation = {
      title: title,
      url: url,
      domain: domain,
      date: new Date().toISOString().split('T')[0] // Use today's date as fallback
    };
    
    return {
      text: textContent,
      citation: citation
    };
  } catch (error) {
    console.error(`Error fetching content from ${url}:`, error);
    return {
      text: '',
      citation: { title: '', url: url, domain: '', date: '' }
    };
  }
}