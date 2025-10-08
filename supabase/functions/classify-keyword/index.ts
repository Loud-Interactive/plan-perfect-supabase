import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { logError, retryWithBackoff } from '../utils/error-handling.ts';
import { normalizeDomain } from '../helpers.ts';

// Interface for keyword classification results
interface KeywordClassification {
  Keyword: string;
  Primary: string;
  Secondary: string;
  Tertiary: string;
  Relevant: string;
  Reasoning: string;
  BusinessRelationshipModel: string;
}

// Constants
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000; // 2 seconds
const BATCH_SIZE = 50;
const FUNCTION_NAME = 'classify-keyword';

serve(async (req) => {
  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  // Validate request method
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }

  try {
    // Get environment variables
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const deepseekApiKey = Deno.env.get('DEEPSEEK_API_KEY');

    // Validate API key
    if (!deepseekApiKey) {
      console.error('[DEBUG] DeepSeek API key is not configured');
      return new Response(
        JSON.stringify({ error: 'DeepSeek API key is not configured' }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Create Supabase client
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get request data
    const { domain: requestDomain, keywords: requestKeywords, ppData, previousResults = [], suggestedCategories = [], jobId } = await req.json();
    let classifiedKeywords = new Map<string, KeywordClassification>();
    let errorMessage = '';
    let domain = requestDomain;
    let keywords = requestKeywords;
    
    // Validate input
    if (!domain) {
      return new Response(JSON.stringify({ 
        error: 'Domain is required', 
        results: [],
        complete: false,
        missingCount: 0,
        success: false
      }), { 
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!keywords || !Array.isArray(keywords)) {
      return new Response(JSON.stringify({ 
        error: 'Keywords array is required',
        results: [],
        complete: false,
        missingCount: 0,
        success: false
      }), { 
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    // Normalize domain
    domain = normalizeDomain(domain);
    
    console.log(`[DEBUG] Classifying ${keywords.length} keywords for domain: ${domain}${jobId ? ` (Job ID: ${jobId})` : ''}`);
    
    // Track problematic keywords that we've tried multiple times
    let problematicKeywords = new Set<string>();
    
    // Always maintain a record of successful classifications
    previousResults.forEach((result: KeywordClassification) => {
      classifiedKeywords.set(result.Keyword.toLowerCase().trim(), result);
    });
    
    // Filter out already classified keywords AND problematic ones
    const remainingKeywords = keywords.filter(keyword => {
      const lowerKeyword = keyword.toLowerCase().trim();
      return !classifiedKeywords.has(lowerKeyword) && !problematicKeywords.has(lowerKeyword);
    });

    if (remainingKeywords.length === 0) {
      console.log('[DEBUG] All possible keywords processed. Returning available results.');
      // Create results array, substituting nulls for problematic keywords
      const results = keywords.map(k => {
        const lowerKeyword = k.toLowerCase().trim();
        return classifiedKeywords.get(lowerKeyword) || null;
      });
      
      const validResults = results.filter(r => r !== null) as KeywordClassification[];
      const missingCount = results.length - validResults.length;
      
      // If jobId is provided, save directly to the database
      if (jobId) {
        console.log(`[SERVER DEBUG] Saving ${validResults.length} classifications directly to database for job ${jobId}`);
        
        try {
          // Save each classification to the database
          for (const classification of validResults) {
            const { Keyword, Primary, Secondary, Tertiary, Relevant, Reasoning, BusinessRelationshipModel } = classification;
            
            // Save to classification_results table
            const { error } = await supabase
              .from('classification_results')
              .insert({
                job_id: jobId,
                batch_data: {
                  keyword: Keyword,
                  primary: Primary,
                  secondary: Secondary,
                  tertiary: Tertiary,
                  relevant: Relevant,
                  reasoning: Reasoning,
                  business_relationship_model: BusinessRelationshipModel
                }
              });
            
            if (error) {
              console.error(`[SERVER DEBUG] Error saving classification for keyword "${Keyword}": ${error.message}`);
            }
          }
          
          // Update job progress
          const { data: job, error: jobError } = await supabase
            .from('classification_jobs')
            .select('keywords, progress')
            .eq('id', jobId)
            .single();
          
          if (job && !jobError) {
            // Calculate new progress percentage
            const totalResults = await supabase
              .from('classification_results')
              .select('id', { count: 'exact' })
              .eq('job_id', jobId);
            
            const progress = Math.min(100, Math.round((totalResults.count || 0) / job.keywords.length * 100));
            
            // Update job progress
            await supabase
              .from('classification_jobs')
              .update({ 
                progress,
                status: progress >= 100 ? 'completed' : 'processing'
              })
              .eq('id', jobId);
              
            console.log(`[SERVER DEBUG] Updated job ${jobId} progress to ${progress}%`);
          }
        } catch (dbError) {
          console.error(`[SERVER DEBUG] Database error: ${dbError}`);
        }
      }
      
      // Return response
      return new Response(JSON.stringify({
        results: validResults,
        complete: missingCount === 0,
        missingCount,
        error: undefined,
        success: validResults.length > 0,
        savedToDatabase: !!jobId
      }), { 
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    console.log(`[DEBUG] Processing ${remainingKeywords.length} remaining keywords`);
    
    // Process keywords
    const prompt = generatePrompt(domain, remainingKeywords, ppData, suggestedCategories.length > 0 ? suggestedCategories : undefined);
    let response = null;
    
    // Retry logic for API calls using retryWithBackoff utility
    try {
      response = await retryWithBackoff(
        async () => classifyWithDeepSeek(prompt, deepseekApiKey),
        MAX_RETRIES,
        RETRY_DELAY
      );
    } catch (error) {
      console.error('[DEBUG] All API call attempts failed:', error);
      errorMessage = error instanceof Error ? error.message : 'Failed after max retries';
      // Don't return here, continue with what we have so far
    }
    
    // Process the response if we have one
    if (response) {
      try {
        const newClassifications = parseClassifications(response);
        
        // Add new classifications to our map
        newClassifications.forEach(classification => {
          // Make sure the keyword is valid before adding
          if (classification && classification.Keyword) {
            classifiedKeywords.set(classification.Keyword.toLowerCase().trim(), classification);
          }
        });
        
        console.log(`[DEBUG] Added ${newClassifications.length} new classifications`);
      } catch (error) {
        console.error('[DEBUG] Error parsing classifications:', error);
        await logError(FUNCTION_NAME, jobId, error instanceof Error ? error : new Error(String(error)), { domain });
        errorMessage = error instanceof Error ? error.message : 'Error parsing classifications';
        // Continue with what we have - this is already good!
      }
    }

    // After classification attempt, identify problematic keywords
    // Find keywords that still failed to classify
    const stillMissingKeywords = keywords.filter(keyword => {
      const lowerKeyword = keyword.toLowerCase().trim();
      return !classifiedKeywords.has(lowerKeyword);
    });
    
    // If we have consistently missing keywords, mark them as problematic
    // to avoid endless loops
    if (stillMissingKeywords.length > 0) {
      stillMissingKeywords.forEach(keyword => {
        problematicKeywords.add(keyword.toLowerCase().trim());
      });
      console.log(`[DEBUG] Marked ${stillMissingKeywords.length} keywords as problematic: ${stillMissingKeywords.join(', ')}`);
    }

    // Final result preparation
    const finalResults = keywords.map(keyword => {
      const result = classifiedKeywords.get(keyword.toLowerCase().trim());
      return result || null;
    });
    
    const missingKeywords = keywords.filter(keyword => {
      const lowerKeyword = keyword.toLowerCase().trim();
      return !classifiedKeywords.has(lowerKeyword);
    });
    
    console.log(`[DEBUG] Final results: ${finalResults.length} total, ${missingKeywords.length} missing`);
    
    // Always return 200 if we have any results
    const validResults = finalResults.filter(result => result !== null) as KeywordClassification[];
    const finalResponse = { 
      results: validResults, 
      complete: missingKeywords.length === 0,
      success: validResults.length > 0,
      missingCount: missingKeywords.length,
      error: errorMessage || undefined
    };
    
    return new Response(
      JSON.stringify(finalResponse),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('[DEBUG] Classification error:', error);
    await logError(FUNCTION_NAME, null, error instanceof Error ? error : new Error(String(error)));
    
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'An unknown error occurred',
        results: [],
        complete: false,
        success: false,
        missingCount: 0,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

/**
 * Generates a prompt for the DeepSeek API to classify keywords
 */
function generatePrompt(domain: string, keywords: string[], ppData: any, suggestedCategories?: string[]): string {
  // Prepare business synopsis
  const business_synopsis = ppData ? `
    Domain: ${ppData.domain}
    Brand Name: ${ppData.brand_name}
    Company Name: ${ppData.company_name}
    Synopsis: ${ppData.synopsis}
    Elevator Pitch: ${ppData.elevator_pitch}
    Industry: ${ppData.industry}
    Business Goals: ${ppData.business_goals}
    USP: ${ppData.usp}
    Key Differentiators: ${ppData.key_differentiators}
    Client Persona: ${ppData.client_persona}
    Market Focus: ${ppData.market_focus}
  ` : '';

  // Prepare optional suggested categories
  const suggestedCategoriesText = suggestedCategories && suggestedCategories.length > 0 
    ? `
  IMPORTANT: ATTEMPT to assign a category to one of these suggested categories FIRST: 
  ${suggestedCategories.join(', ')}
  If none of them are relevant, then choose an appropriate category for it to be in.` 
    : '';

  const keywordPrompt = `Given the following keywords, I want you to help me classify each of them. 
  For each keyword, I want you to give me:
  1. primary, 2. secondary & 3. tertiary categories, 
  4. Determine if it is B2B, B2C, etc... 5. your reasoning for if it is relevant or not. 
  It is important that you include either the brand name or domain name in your reasoning. You should only respond with one phrase per category and attempt to stay consistent in your classifications to only have a few dozen categories, subcategories, and tertiary categories. 6. Please categorize the following list of keyphrases based on the most likely business relationship model. You keep doing this evaluation wrong. So, to put it another way, what is the intent of the search? Is it to find a solution solved within a b2b relationship a b2c relationship, etc. etc. etc.?${suggestedCategoriesText}
  
  When considering if it is relevant consider what you know about the company located at ${domain}. It is important that the reasoning includes how it is relevant to the keyword based on the company's core business.

  Review the entire list first to understand the context before categorizing each keyphrase. Only assign one business relationship model (the most likely) to each keyphrase.

  1. Primary category (you must select one after evaluating all keyphrases)
  2. Secondary category (you must select one after evaluating all keyphrases)
  3. Tertiary category (you must select one after evaluating all keyphrases)
  4. Relevant (you must determine, "Relevant" or "Not Relevant" responses only)
  5. Your reasoning as to why you selected it as relevant or not relevant
  6. Business relationship models:

  B2B (Business-to-Business)
  Definition: Transactions between businesses.
  Example: A manufacturer selling raw materials to a factory.
  Example Search Phrases:
  industrial equipment suppliers for factories
  wholesale raw materials for manufacturing
  corporate software solutions providers
  B2B marketing strategies
  logistics services for businesses

  B2C (Business-to-Consumer)
  Definition: Transactions between businesses and individual consumers.
  Example: A retail store selling products to individual customers.
  Example Search Phrases:
  online retail stores for electronics
  best consumer banking services
  clothing brands for teenagers
  subscription boxes for kids
  direct-to-consumer mattress companies

  B2G (Business-to-Government)
  Definition: Transactions between businesses and government entities.
  Example: A software company providing services to a government agency.
  Example Search Phrases:
  government contract opportunities for IT companies
  healthcare services for public sector
  B2G procurement process
  construction companies with government contracts
  environmental consulting services for government projects

  B2E (Business-to-Employee)
  Definition: Transactions or services provided by a business to its employees.
  Example: A company offering employee discounts or an internal service portal.
  Example Search Phrases:
  corporate wellness programs for employees
  employee training software
  discount programs for company staff
  internal employee communication tools
  B2E benefits platforms

  C2C (Consumer-to-Consumer)
  Definition: Transactions between individual consumers.
  Example: An online marketplace where individuals buy and sell items from each other.
  Example Search Phrases:
  peer-to-peer selling websites
  C2C marketplaces for handmade goods
  how to sell on eBay
  best platforms for second-hand items
  peer-to-peer rental services

  C2B (Consumer-to-Business)
  Definition: Transactions where individual consumers offer products or services to businesses.
  Example: Freelancers providing services to companies through online platforms.
  Example Search Phrases:
  freelance platforms for graphic designers
  C2B services for photography
  sell your expertise to businesses
  consumer feedback for product development
  influencer marketing platforms for brands

  G2B (Government-to-Business)
  Definition: Transactions or services provided by government entities to businesses.
  Example: Government contracts or regulatory services provided to businesses.
  Example Search Phrases:
  government grants for small businesses
  regulatory compliance services
  G2B licensing requirements
  tax incentives for businesses
  business support services from local government

  G2C (Government-to-Citizen)
  Definition: Services or information provided by government entities directly to individuals.
  Example: Public services like healthcare, education, or tax services.
  Example Search Phrases:
  how to apply for a passport online
  government health services
  G2C tax filing assistance
  public education resources
  social security benefits application

  B2B2C (Business-to-Business-to-Consumer)
  Definition: A business sells products or services to another business, which then sells them to consumers.
  Example: A wholesaler sells products to a retailer, who then sells them to the end consumers.
  Example Search Phrases:
  wholesale to retail business model
  B2B2C ecommerce platforms
  supply chain management for B2B2C
  distributors for consumer electronics
  partnering with retailers for B2B2C

  C2G (Consumer-to-Government)
  Definition: Interactions where individuals provide feedback, taxes, or information to the government.
  Example: Citizens paying taxes online or participating in public consultations.
  Example Search Phrases:
  how to pay taxes online
  submit feedback to local government
  apply for government services
  report a problem to city council
  participate in public consultations

  G2G (Government-to-Government)
  Definition: Transactions or collaborations between different government entities.
  Example: Data sharing between national and local government agencies.
  Example Search Phrases:
  data sharing agreements between agencies
  G2G collaboration platforms
  inter-governmental grants and funding
  government to government communication tools
  G2G emergency response coordination

  B2B2B (Business-to-Business-to-Business)
  Definition: A business sells products or services to another business, which then sells them to another business.
  Example: A parts supplier sells to a manufacturer, who then sells to a distributor.
  Example Search Phrases:
  multi-tier B2B supply chain management
  industrial parts distributor network
  B2B2B partnerships in manufacturing
  logistics solutions for B2B2B
  enterprise software providers for B2B2B

  P2P (Peer-to-Peer)
  Definition: Transactions or sharing of resources between individuals, typically facilitated by a platform.
  Example: Sharing economy platforms like Airbnb or ride-sharing services like Uber.
  Example Search Phrases:
  peer-to-peer car sharing services
  P2P lending platforms
  peer-to-peer accommodation rentals
  P2P payment apps
  community-based sharing platforms

  D2C (Direct-to-Consumer)
  Definition: Businesses sell directly to consumers, bypassing traditional retail intermediaries.
  Example: An e-commerce brand selling its products exclusively through its own website.
  Example Search Phrases:
  direct-to-consumer brands
  D2C ecommerce strategies
  how to start a D2C business
  benefits of D2C sales
  D2C marketing best practices

  B2B4C (Business-to-Business-for-Consumer)
  Definition: Businesses collaborate to provide a product or service that ultimately benefits the consumer.
  Example: Two tech companies partnering to create a new consumer app.
  Example Search Phrases:
  B2B4C partnerships in tech
  collaborative consumer solutions
  B2B4C business models
  customer-centric B2B collaborations
  integrated solutions for end consumers

  O2O (Online-to-Offline)
  Definition: Businesses drive online customers to physical locations or experiences.
  Example: E-commerce platforms offering in-store pickup options.
  Example Search Phrases:
  O2O marketing strategies
  online to offline retail models
  bridging ecommerce and physical stores
  O2O customer engagement
  drive traffic from online to offline

  H2H (Human-to-Human)
  Definition: Emphasizes the personal and emotional connections in business interactions, often used in marketing contexts.
  Example: Brands creating personalized customer service experiences.
  Example Search Phrases:
  H2H marketing strategies
  human-centered business approach
  building emotional connections with customers
  personalized customer service examples
  humanizing brand interactions

  Here is a synopsis that provides an overview of the company as well as an elevator pitch. Here is that additional context:
  ${business_synopsis}

  IMPORTANT You will respond only with a 7 column table, using the pipe character (|) as the delimiter between columns.
  You do not need to label these columns, as they are already labeled.
  Do not include a header row. Do not include any labels or explanations.
  There should be no additional comments; it should only be the table.
  No comments, just the pipe-delimited table.
  they must be in this order: Keyword | Primary | Secondary | Tertiary | Relevant | Reasoning | business relationship model
  inside of the table tag.


  Here is an example:
  <table>
  Keyword | Primary | Secondary | Tertiary | Relevant | Reasoning | business relationship model
  Keyword2 | Primary2 | Secondary2 | Tertiary2 | Relevant2 | Reasoning2 | business relationship model2
  </table>

  here is the list of keyphrases:
  ${keywords.join('\n')}`;
  
  return keywordPrompt;
}

/**
 * Calls the DeepSeek API to classify keywords
 */
async function classifyWithDeepSeek(prompt: string, apiKey: string): Promise<string> {
  const apiBaseUrl = 'https://api.deepseek.com/chat/completions';
  
  const response = await fetch(apiBaseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-reasoner',
      messages: [
        { role: 'user', content: prompt },
      ],
      max_tokens: 8000,
      stream: false,
    }),
  });

  if (!response.ok) {
    console.error(`[DEBUG] DeepSeek API error: ${response.status}`);
    const error = await response.text();
    console.error(`[DEBUG] DeepSeek API error details:`, error);
    throw new Error(`DeepSeek API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  if (!data.choices || !data.choices[0] || !data.choices[0].message) {
    console.error('[DEBUG] Invalid response format from DeepSeek API:', data);
    throw new Error('Invalid response format from DeepSeek API');
  }

  return data.choices[0].message.content;
}

/**
 * Parses the classification response from DeepSeek API
 */
function parseClassifications(rawClassification: string): KeywordClassification[] {
  try {
    // Remove any thinking section from the response
    let processedResponse = rawClassification;
    
    // Check if there's a thinking section and extract only content after it
    const thinkEndIndex = processedResponse.indexOf('</think>');
    if (thinkEndIndex !== -1) {
      // Get only the content after the </think> tag
      processedResponse = processedResponse.substring(thinkEndIndex + 9).trim();
      console.log('[DEBUG] Removed thinking section from response');
    }

    // Extract content within <table> tags
    const tableMatch = processedResponse.match(/<table>([\s\S]*?)<\/table>/);
    if (!tableMatch) {
      console.error('[DEBUG] No table content found in response');
      console.error('[DEBUG] Processed response:', processedResponse);
      return [];
    }

    // Extract rows from table content
    const tableContent = tableMatch[1];
    const rows = tableContent.split('\n')
      .map(row => row.trim())
      .filter(row => row.length > 0 && row.includes('|')); // Only include rows with pipe separators

    console.log(`[DEBUG] Found ${rows.length} rows in table`);
    
    if (rows.length === 0) {
      console.error('[DEBUG] No valid rows found in table');
      return [];
    }

    // Process each data row
    const classifications = rows.map(row => {
      try {
        const cells = row.split('|').map(cell => cell.trim());
        
        // Validate cell count
        if (cells.length < 7) {
          console.error('[DEBUG] Invalid row format:', row);
          return null;
        }

        const [keyword, primary, secondary, tertiary, relevance, reasoning, businessRelationshipModel] = cells;
        
        // Convert relevance values
        let parsedRelevance = relevance === 'Not Relevant' ? 'No' : 'Yes';

        return {
          Keyword: keyword,
          Primary: primary,
          Secondary: secondary,
          Tertiary: tertiary,
          Relevant: parsedRelevance,
          Reasoning: reasoning,
          BusinessRelationshipModel: businessRelationshipModel
        };
      } catch (error) {
        console.error('[DEBUG] Error processing row:', row, error);
        return null;
      }
    }).filter(item => item !== null) as KeywordClassification[];

    console.log(`[DEBUG] Successfully parsed ${classifications.length} classifications`);
    return classifications;

  } catch (error) {
    console.error('[DEBUG] Error parsing classifications:', error);
    console.error('[DEBUG] Raw classification:', rawClassification);
    throw error;
  }
}