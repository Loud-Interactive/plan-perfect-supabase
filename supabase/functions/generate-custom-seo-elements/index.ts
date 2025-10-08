import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import { callDeepSeekWithLogging } from '../utils/model-logging.ts';

const FUNCTION_NAME = 'generate-custom-seo-elements';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Initialize Supabase client
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Get API key from environment
const DEEPSEEK_API_KEY = Deno.env.get('DEEPSEEK_API_KEY');

interface DataShapeField {
  name: string;
  description: string;
  maxLength?: number;
  type?: string;
  businessUnits?: string[];
  required?: boolean;
}

interface DataShapeSchema {
  fields: DataShapeField[];
  businessUnits?: {
    [key: string]: string;
  };
  instructions?: string;
}

interface CustomSEORequest {
  pageId?: string;
  url?: string;
  dataShape?: string; // Plain English description
  dataShapeSchema?: DataShapeSchema; // Pre-parsed schema
  dataShapeTemplateName?: string; // Name of saved template to use
  businessUnit?: string;
  existingData?: any;
  deepseekApiKey?: string;
  saveAsTemplate?: { // Option to save the shape as a template
    name: string;
    description?: string;
    category?: string;
  };
  fastMode?: boolean; // Skip expensive operations for bulk processing
}

// Convert plain English data shape to JSON schema using DeepSeek
async function parseDataShape(dataShapeText: string, apiKey: string): Promise<DataShapeSchema> {
  const systemPrompt = `You are a data schema parser. Convert plain English descriptions of data structures into JSON schemas.
Extract field names, descriptions, constraints (like max length), and any business unit variations.
Return a JSON object with a 'fields' array containing field definitions.`;

  const userPrompt = `Parse this data shape description into a JSON schema:

${dataShapeText}

Return ONLY the JSON object wrapped in <results> tags. Do not include any markdown formatting or code blocks.

Example format:
<results>
{
  "fields": [
    {
      "name": "fieldName",
      "description": "what this field is for",
      "maxLength": 100,
      "type": "string",
      "businessUnits": ["OTC", "FX"],
      "required": true
    }
  ],
  "businessUnits": {
    "OTC": "Oriental Trading Co.",
    "FX": "FunExpress"
  },
  "instructions": "any special instructions extracted"
}
</results>`;

  try {
    const { response, thinking } = await callDeepSeekWithLogging(
      FUNCTION_NAME,
      `${systemPrompt}\n\n${userPrompt}`,
      apiKey,
      null,
      { action: 'parse_data_shape' }
    );

    // Extract from <results> tags or clean up markdown
    const resultsMatch = response.match(/<results>\s*([\s\S]*?)\s*<\/results>/i);
    if (resultsMatch) {
      return JSON.parse(resultsMatch[1]);
    }
    
    // Fallback: try to parse directly or clean markdown
    let cleanedResponse = response;
    cleanedResponse = cleanedResponse.replace(/```json\s*/gi, '');
    cleanedResponse = cleanedResponse.replace(/```\s*/g, '');
    return JSON.parse(cleanedResponse.trim());
  } catch (error) {
    console.error('Error parsing data shape:', error);
    throw error;
  }
}

// Parse the Oriental Trading data shape into a schema
function parseOrientalTradingShape(): DataShapeSchema {
  return {
    businessUnits: {
      "OTC": "Oriental Trading Co.",
      "FX": "FunExpress",
      "MC": "MorrisCostumes", 
      "HEX": "HalloweenExpress",
      "MW": "Mindware",
      "MWH": "Mindware Wholesale"
    },
    fields: [
      {
        name: "tagLine",
        description: "A slogan that displays in schema markup - should be unique and brand-agnostic",
        maxLength: 100,
        type: "string",
        required: false
      },
      // Generate unique web titles for each business unit
      {
        name: "webTitle_FX",
        description: "Product name for FunExpress - should reflect FX brand voice and target audience",
        maxLength: 254,
        type: "string",
        required: true
      },
      {
        name: "webTitle_HEX", 
        description: "Product name for HalloweenExpress - should reflect HEX brand voice and Halloween focus",
        maxLength: 254,
        type: "string",
        required: true
      },
      {
        name: "webTitle_OTC",
        description: "Product name for Oriental Trading Co - should reflect OTC brand voice and party/craft focus",
        maxLength: 254,
        type: "string", 
        required: true
      },
      {
        name: "webTitle_MOR",
        description: "Product name for MorrisCostumes - should reflect costume and theater focus",
        maxLength: 254,
        type: "string",
        required: true
      },
      {
        name: "webTitle_MW",
        description: "Product name for Mindware - should reflect educational and brain-building focus",
        maxLength: 254,
        type: "string",
        required: true
      },
      {
        name: "webTitle_MWH",
        description: "Product name for Mindware Wholesale - should reflect B2B educational market",
        maxLength: 254,
        type: "string", 
        required: true
      },
      // Generate unique long descriptions for each business unit
      {
        name: "longDescription_FX",
        description: "Main body copy for FunExpress - emphasize fun, party, and celebration aspects",
        maxLength: 2000,
        type: "string",
        required: true
      },
      {
        name: "longDescription_HEX",
        description: "Main body copy for HalloweenExpress - emphasize Halloween, spooky, and costume aspects", 
        maxLength: 2000,
        type: "string",
        required: true
      },
      {
        name: "longDescription_OTC",
        description: "Main body copy for Oriental Trading Co - emphasize creativity, crafts, and party planning",
        maxLength: 2000,
        type: "string",
        required: true
      },
      {
        name: "longDescription_MOR",
        description: "Main body copy for MorrisCostumes - emphasize theater, performance, and authentic costumes",
        maxLength: 2000,
        type: "string",
        required: true
      },
      {
        name: "longDescription_MW",
        description: "Main body copy for Mindware - emphasize learning, development, and educational value",
        maxLength: 2000, 
        type: "string",
        required: true
      },
      {
        name: "longDescription_MWH",
        description: "Main body copy for Mindware Wholesale - emphasize bulk educational solutions for retailers",
        maxLength: 2000,
        type: "string",
        required: true
      },
      // Generate bullet points for each business unit (5 per unit)
      {
        name: "bulletPoints_FX",
        description: "5 product features for FunExpress focusing on party and fun aspects",
        maxLength: 120,
        type: "array",
        arraySize: 5,
        required: false
      },
      {
        name: "bulletPoints_HEX", 
        description: "5 product features for HalloweenExpress focusing on Halloween and spooky aspects",
        maxLength: 120,
        type: "array",
        arraySize: 5,
        required: false
      },
      {
        name: "bulletPoints_MOR",
        description: "5 product features for MorrisCostumes focusing on theater and costume quality",
        maxLength: 120,
        type: "array", 
        arraySize: 5,
        required: false
      },
      {
        name: "bulletPoints_MW",
        description: "5 product features for Mindware focusing on educational and developmental benefits",
        maxLength: 120,
        type: "array",
        arraySize: 5,
        required: false
      },
      {
        name: "bulletPoints_MWH",
        description: "5 product features for Mindware Wholesale focusing on bulk and B2B benefits", 
        maxLength: 120,
        type: "array",
        arraySize: 5,
        required: false
      },
      {
        name: "bulletPoints_OTC",
        description: "5 product features for Oriental Trading Co focusing on crafts and creativity",
        maxLength: 120,
        type: "array",
        arraySize: 5,
        required: false
      },
      // Generate unique meta descriptions for each business unit
      {
        name: "metaDescription_FX",
        description: "SEO meta description for FunExpress - unique for search results, party-focused",
        maxLength: 255,
        type: "string",
        required: true
      },
      {
        name: "metaDescription_HEX",
        description: "SEO meta description for HalloweenExpress - unique for search results, Halloween-focused",
        maxLength: 255,
        type: "string",
        required: true
      },
      {
        name: "metaDescription_MOR", 
        description: "SEO meta description for MorrisCostumes - unique for search results, costume-focused",
        maxLength: 255,
        type: "string",
        required: true
      },
      {
        name: "metaDescription_MW",
        description: "SEO meta description for Mindware - unique for search results, education-focused",
        maxLength: 255,
        type: "string",
        required: true
      },
      {
        name: "metaDescription_MWH",
        description: "SEO meta description for Mindware Wholesale - unique for search results, B2B-focused",
        maxLength: 255,
        type: "string",
        required: true
      },
      {
        name: "metaDescription_OTC",
        description: "SEO meta description for Oriental Trading Co - unique for search results, craft-focused",
        maxLength: 255,
        type: "string",
        required: true
      },
      // Generate unique OG descriptions for each business unit
      {
        name: "ogDescription_FX",
        description: "Open Graph description for FunExpress social sharing",
        maxLength: 255,
        type: "string",
        required: false
      },
      {
        name: "ogDescription_HEX",
        description: "Open Graph description for HalloweenExpress social sharing",
        maxLength: 255,
        type: "string", 
        required: false
      },
      {
        name: "ogDescription_MOR",
        description: "Open Graph description for MorrisCostumes social sharing",
        maxLength: 255,
        type: "string",
        required: false
      },
      {
        name: "ogDescription_MW",
        description: "Open Graph description for Mindware social sharing",
        maxLength: 255,
        type: "string",
        required: false
      },
      {
        name: "ogDescription_MWH",
        description: "Open Graph description for Mindware Wholesale social sharing", 
        maxLength: 255,
        type: "string",
        required: false
      },
      {
        name: "ogDescription_OTC",
        description: "Open Graph description for Oriental Trading Co social sharing",
        maxLength: 255,
        type: "string",
        required: false
      },
      // Generate unique SEO content block titles for each business unit
      {
        name: "seoContentBlockTitle_FX",
        description: "SEO content block title for FunExpress PDP",
        maxLength: 255,
        type: "string",
        required: false
      },
      {
        name: "seoContentBlockTitle_HEX",
        description: "SEO content block title for HalloweenExpress PDP",
        maxLength: 255,
        type: "string",
        required: false
      },
      {
        name: "seoContentBlockTitle_MOR",
        description: "SEO content block title for MorrisCostumes PDP", 
        maxLength: 255,
        type: "string",
        required: false
      },
      {
        name: "seoContentBlockTitle_MW",
        description: "SEO content block title for Mindware PDP",
        maxLength: 255,
        type: "string",
        required: false
      },
      {
        name: "seoContentBlockTitle_MWH",
        description: "SEO content block title for Mindware Wholesale PDP",
        maxLength: 255,
        type: "string",
        required: false
      },
      {
        name: "seoContentBlockTitle_OTC",
        description: "SEO content block title for Oriental Trading Co PDP",
        maxLength: 255,
        type: "string",
        required: false
      },
      // Generate unique SEO content block bodies for each business unit
      {
        name: "seoContentBlockBody_FX",
        description: "SEO content block body for FunExpress PDP",
        maxLength: 1600,
        type: "string",
        required: false
      },
      {
        name: "seoContentBlockBody_HEX",
        description: "SEO content block body for HalloweenExpress PDP",
        maxLength: 1600,
        type: "string", 
        required: false
      },
      {
        name: "seoContentBlockBody_MOR",
        description: "SEO content block body for MorrisCostumes PDP",
        maxLength: 1600,
        type: "string",
        required: false
      },
      {
        name: "seoContentBlockBody_MW",
        description: "SEO content block body for Mindware PDP",
        maxLength: 1600,
        type: "string",
        required: false
      },
      {
        name: "seoContentBlockBody_MWH",
        description: "SEO content block body for Mindware Wholesale PDP",
        maxLength: 1600,
        type: "string",
        required: false
      },
      {
        name: "seoContentBlockBody_OTC",
        description: "SEO content block body for Oriental Trading Co PDP",
        maxLength: 1600,
        type: "string",
        required: false
      },
      // Generate unique title tags for each business unit
      {
        name: "titleTag_FX",
        description: "HTML title tag for FunExpress - unique for search results",
        maxLength: 254,
        type: "string",
        required: false
      },
      {
        name: "titleTag_HEX",
        description: "HTML title tag for HalloweenExpress - unique for search results",
        maxLength: 254,
        type: "string",
        required: false
      },
      {
        name: "titleTag_MOR",
        description: "HTML title tag for MorrisCostumes - unique for search results",
        maxLength: 254,
        type: "string",
        required: false
      },
      {
        name: "titleTag_MW",
        description: "HTML title tag for Mindware - unique for search results",
        maxLength: 254,
        type: "string", 
        required: false
      },
      {
        name: "titleTag_MWH",
        description: "HTML title tag for Mindware Wholesale - unique for search results",
        maxLength: 254,
        type: "string",
        required: false
      },
      {
        name: "titleTag_OTC",
        description: "HTML title tag for Oriental Trading Co - unique for search results",
        maxLength: 254,
        type: "string",
        required: false
      }
    ],
    instructions: "Generate SEO-optimized content for product pages with UNIQUE content for each business unit. Each field should be distinctly different to avoid duplicate content issues in search results. Tailor content to each brand's voice: FX (fun/party), HEX (Halloween/spooky), OTC (crafts/creativity), MOR (theater/costumes), MW (education/learning), MWH (B2B/wholesale). Ensure no two business units have identical or near-identical content."
  };
}

// Generate content based on schema using DeepSeek
async function generateCustomContent(
  schema: DataShapeSchema,
  pageData: any,
  businessUnit: string | undefined,
  apiKey: string
): Promise<{ content: any; thinking: string }> {
  // Build the prompt based on schema
  let systemPrompt = `You are an expert SEO content generator. Generate content according to the provided schema.`;
  
  if (schema.instructions) {
    systemPrompt += `\n\nSpecial Instructions: ${schema.instructions}`;
  }

  // Get today's date for time-sensitive content
  const today = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // Build field descriptions
  const fieldDescriptions = schema.fields.map(field => {
    let desc = `- ${field.name}: ${field.description}`;
    if (field.maxLength) desc += ` (max ${field.maxLength} chars)`;
    if (field.type === 'array') desc += ` (provide as array)`;
    if (field.businessUnits && businessUnit) {
      desc += ` (for ${businessUnit} brand)`;
    }
    return desc;
  }).join('\n');

  const userPrompt = `Generate SEO content for the following page:
URL: ${pageData.url}
Current Title: ${pageData.title || 'N/A'}
Current Description: ${pageData.meta_description || 'N/A'}

⚠️ **Today's date is ${today}.** Update any dates to be current and relevant.

${businessUnit ? `Business Unit: ${businessUnit} (${schema.businessUnits?.[businessUnit] || businessUnit})` : ''}

Generate content for these fields:
${fieldDescriptions}

Page Content Summary:
${pageData.content_summary || pageData.h1 || 'No content available'}

Keywords: ${pageData.keywords?.join(', ') || 'No keywords available'}

Return ONLY the JSON object wrapped in <results> tags. Do not include any markdown formatting or code blocks.

Example format:
<results>
{
  "fieldName": "value",
  "anotherField": "another value"
}
</results>

Ensure all content is SEO-optimized, includes relevant keywords naturally, and adheres to character limits.

For business unit specific fields, only include the field name without the business unit suffix. For example, if generating "webTitle" for OTC, just return "webTitle" in the JSON, not "webTitle_OTC".`;

  try {
    // Call DeepSeek with logging
    const metadata = {
      pageId: pageData.id || null,
      url: pageData.url,
      businessUnit: businessUnit || null,
      schemaFieldCount: schema.fields.length
    };

    const { response: modelResponse, thinking } = await callDeepSeekWithLogging(
      FUNCTION_NAME,
      `${systemPrompt}\n\n${userPrompt}`,
      apiKey,
      pageData.domain || null,
      metadata
    );

    // Parse the response as JSON
    let content;
    try {
      // First try to extract from <results> tags
      const resultsMatch = modelResponse.match(/<results>\s*([\s\S]*?)\s*<\/results>/i);
      if (resultsMatch) {
        content = JSON.parse(resultsMatch[1]);
      } else {
        // Try to clean up markdown formatting if present
        let cleanedResponse = modelResponse;
        
        // Remove markdown code blocks
        cleanedResponse = cleanedResponse.replace(/```json\s*/gi, '');
        cleanedResponse = cleanedResponse.replace(/```\s*/g, '');
        
        // Try to parse
        content = JSON.parse(cleanedResponse.trim());
      }
    } catch (parseError) {
      console.error('Failed to parse DeepSeek response as JSON:', parseError);
      console.error('Raw response:', modelResponse);
      
      // Last attempt: try to extract JSON from anywhere in the response
      const jsonMatch = modelResponse.match(/{[\s\S]*}/); 
      if (jsonMatch) {
        try {
          content = JSON.parse(jsonMatch[0]);
        } catch (e) {
          throw new Error('Invalid JSON response from model: ' + parseError.message);
        }
      } else {
        throw new Error('No valid JSON found in model response');
      }
    }

    return { content, thinking };
  } catch (error) {
    console.error('Error generating content:', error);
    throw error;
  }
}

// Main handler
serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const requestData: CustomSEORequest = await req.json();
    const { pageId, url, dataShape, dataShapeSchema, dataShapeTemplateName, businessUnit, existingData, deepseekApiKey, saveAsTemplate, fastMode } = requestData;

    console.log('=== Custom SEO Generation Flow Started ===');
    console.log(`URL: ${url || 'N/A'}`);
    console.log(`Page ID: ${pageId || 'N/A'}`);
    console.log(`Business Unit: ${businessUnit || 'N/A'}`);
    
    // Use API key from request or environment
    const apiKey = deepseekApiKey || DEEPSEEK_API_KEY;
    if (!apiKey) {
      throw new Error('DeepSeek API key is required');
    }
    
    console.log('\nStep 1: Get or prepare page data...');
    console.log(`Fast mode: ${fastMode ? 'enabled' : 'disabled'}`);

    // Get page data
    let pageData: any;
    if (pageId) {
      const { data, error } = await supabase
        .from('pages')
        .select('*')
        .eq('id', pageId)
        .single();
      
      if (error && error.code !== 'PGRST116') throw error;
      pageData = data;
    } else if (url) {
      // First try to find existing page
      const { data: existingPages, error: fetchError } = await supabase
        .from('pages')
        .select('*')
        .eq('url', url);
      
      if (fetchError) throw fetchError;
      
      if (existingPages && existingPages.length > 0) {
        // Use the first matching page
        pageData = existingPages[0];
      } else if (fastMode) {
        // In fast mode, skip crawling and use minimal data
        console.log(`Fast mode: skipping crawl for ${url}`);
        pageData = {
          id: null,
          url: url,
          domain: new URL(url).hostname,
          title: existingData?.productName || 'Product Page',
          meta_description: '',
          h1: existingData?.productName || 'Product',
          fast_mode: true
        };
      } else {
        // Page doesn't exist - crawl it first (only in non-fast mode)
        console.log(`Page not found in database, crawling: ${url}`);
        
        try {
          // Call the crawl-page-html function
          const crawlResponse = await fetch(`${supabaseUrl}/functions/v1/crawl-page-html`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${supabaseServiceKey}`
            },
            body: JSON.stringify({ url })
          });
          
          if (!crawlResponse.ok) {
            const errorText = await crawlResponse.text();
            throw new Error(`Failed to crawl page: ${errorText}`);
          }
          
          const crawlResult = await crawlResponse.json();
          
          if (!crawlResult.success) {
            throw new Error(`Crawl failed: ${crawlResult.error || 'Unknown error'}`);
          }
          
          // Extract domain from URL
          const urlObj = new URL(url);
          const domain = urlObj.hostname;
          
          // Create the page in database
          const { data: newPage, error: createError } = await supabase
            .from('pages')
            .insert({
              url: url,
              domain: domain,
              html: crawlResult.html || '',
              html_length: crawlResult.htmlLength || 0,
              status_code: crawlResult.statusCode || 200,
              title: crawlResult.title || '',
              meta_description: crawlResult.metaDescription || '',
              h1: crawlResult.h1 || '',
              crawled_at: new Date().toISOString()
            })
            .select()
            .single();
          
          if (createError) {
            console.error('Error creating page:', createError);
            // If insert fails due to duplicate, try to fetch again
            const { data: retryPages } = await supabase
              .from('pages')
              .select('*')
              .eq('url', url);
            
            if (retryPages && retryPages.length > 0) {
              pageData = retryPages[0];
            } else {
              throw createError;
            }
          } else {
            pageData = newPage;
            console.log(`Successfully created page: ${pageData.id}`);
          }
          
        } catch (crawlError) {
          console.error('Error crawling page:', crawlError);
          // Fall back to minimal data if crawl fails
          pageData = {
            id: null,
            url: url,
            domain: new URL(url).hostname,
            error: crawlError.message
          };
        }
      }
    } else {
      throw new Error('Either pageId or url is required');
    }

    console.log('\nStep 2: Parse or load data shape schema...');
    // Get or parse schema
    let schema: DataShapeSchema;
    let templateSource: string | null = null;
    
    if (dataShapeTemplateName) {
      // Load from saved template
      const { data: template, error: templateError } = await supabase
        .from('data_shape_templates')
        .select('*')
        .eq('name', dataShapeTemplateName)
        .eq('is_active', true)
        .single();
      
      if (templateError || !template) {
        throw new Error(`Template '${dataShapeTemplateName}' not found`);
      }
      
      schema = template.schema_definition as DataShapeSchema;
      templateSource = `template:${dataShapeTemplateName}`;
      
    } else if (dataShapeSchema) {
      schema = dataShapeSchema;
      templateSource = 'provided-schema';
      
    } else if (dataShape) {
      // Check if it's requesting Oriental Trading schema
      if (dataShape.toLowerCase().includes('oriental trading') || 
          dataShape.toLowerCase().includes('otc')) {
        schema = parseOrientalTradingShape();
        templateSource = 'built-in:oriental-trading';
      } else {
        schema = await parseDataShape(dataShape, apiKey);
        templateSource = 'parsed-from-plain-english';
      }
    } else {
      throw new Error('Either dataShape, dataShapeSchema, or dataShapeTemplateName is required');
    }
    
    // Save as template if requested
    if (saveAsTemplate && dataShape) {
      const { error: saveError } = await supabase
        .from('data_shape_templates')
        .insert({
          name: saveAsTemplate.name,
          description: saveAsTemplate.description,
          category: saveAsTemplate.category,
          plain_english_definition: dataShape,
          schema_definition: schema
        });
      
      if (saveError && !saveError.message.includes('duplicate')) {
        console.error('Error saving template:', saveError);
      }
    }

    console.log('\nStep 3: Check for existing SEO data and GSC keywords...');
    // Get existing SEO data and keywords (only if page exists)
    let seoData = null;
    let keywords = null;
    
    if (pageData.id) {
      const { data: seoResult } = await supabase
        .from('page_seo_recommendations')
        .select('*')
        .eq('page_id', pageData.id)
        .single();
      
      seoData = seoResult;
    }
    
    // Get keywords by URL or page_id
    if (pageData.id) {
      const { data: keywordData } = await supabase
        .from('gsc_keywords')
        .select('keyword, clicks, impressions, position')
        .or(`page_url.eq.${pageData.url},page_id.eq.${pageData.id}`)
        .order('impressions', { ascending: false })
        .limit(20);
      
      keywords = keywordData;
    } else {
      // Try just by URL
      const { data: keywordData } = await supabase
        .from('gsc_keywords')
        .select('keyword, clicks, impressions, position')
        .eq('page_url', pageData.url)
        .order('impressions', { ascending: false })
        .limit(20);
      
      keywords = keywordData;
    }
    
    console.log(`Found ${keywords?.length || 0} GSC keywords in database for ${pageData.url}`);
    
    // If no GSC keywords in database, try to fetch from GSC API
    if ((!keywords || keywords.length === 0) && pageData.id && pageData.domain) {
      console.log('No GSC keywords in database, attempting to fetch from GSC API...');
      
      try {
        const gscResponse = await fetch(`${supabaseUrl}/functions/v1/fetch-gsc-data`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseServiceKey}`
          },
          body: JSON.stringify({
            pageId: pageData.id,
            url: pageData.url
          })
        });
        
        if (gscResponse.ok) {
          const gscResult = await gscResponse.json();
          if (gscResult.success && gscResult.gsc_data && gscResult.gsc_data.top_keywords) {
            console.log(`Fetched ${gscResult.gsc_data.top_keywords.length} keywords from GSC API`);
            keywords = gscResult.gsc_data.top_keywords;
          }
        } else {
          console.log('Could not fetch GSC keywords:', await gscResponse.text());
        }
      } catch (gscError) {
        console.error('Error fetching GSC keywords:', gscError);
      }
    }
    
    // If we still have fewer than 3 keywords, generate some using AI
    if (!keywords || keywords.length < 3) {
      console.log('Insufficient keywords found, generating additional keywords with AI...');
      
      try {
        // Only try to generate keywords if we have a page_id and HTML content
        if (pageData.id && pageData.html && pageData.html.length > 100) {
          const keywordResponse = await fetch(`${supabaseUrl}/functions/v1/extract-content-keywords`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${supabaseServiceKey}`
            },
            body: JSON.stringify({
              pageId: pageData.id,
              saveToDatabase: true
            })
          });
          
          if (keywordResponse.ok) {
            const keywordResult = await keywordResponse.json();
            
            if (keywordResult.success && Array.isArray(keywordResult.gscCompatibleKeywords)) {
              console.log(`Generated ${keywordResult.gscCompatibleKeywords.length} AI keywords`);
              
              // Merge AI keywords with existing ones
              const existingKeywordTexts = new Set((keywords || []).map(k => k.keyword?.toLowerCase()));
              const aiKeywords = keywordResult.gscCompatibleKeywords.filter(
                k => !existingKeywordTexts.has(k.keyword?.toLowerCase())
              );
              
              // Combine keywords
              keywords = [...(keywords || []), ...aiKeywords];
              console.log(`Total keywords after AI generation: ${keywords.length}`);
            }
          } else {
            console.error('Failed to generate AI keywords:', await keywordResponse.text());
          }
        } else {
          console.log('Cannot generate AI keywords - no page content available');
        }
      } catch (aiError) {
        console.error('Error generating AI keywords:', aiError);
      }
    }

    console.log('\nStep 4: Prepare enriched page data...');
    // Prepare page data with keywords and content summary
    const enrichedPageData = {
      ...pageData,
      ...existingData,
      keywords: keywords?.map(k => k.keyword) || [],
      existing_seo: seoData,
      domain: pageData.domain || (pageData.url ? new URL(pageData.url).hostname : null),
      content_summary: pageData.h1 || pageData.title || existingData?.content_summary || existingData?.productName || 'Product page'
    };

    console.log('\nStep 5: Generate SEO content using DeepSeek...');
    console.log(`Using ${keywords?.length || 0} keywords for optimization`);
    
    // Generate content
    const { content: generatedContent, thinking } = await generateCustomContent(
      schema,
      enrichedPageData,
      businessUnit,
      apiKey
    );

    console.log('\nStep 6: Store results in database...');
    // Store the results
    const { error: upsertError } = await supabase
      .from('custom_seo_content')
      .upsert({
        page_id: pageData.id,
        url: pageData.url,
        business_unit: businessUnit,
        schema_definition: schema,
        template_source: templateSource,
        generated_content: generatedContent,
        model_used: 'deepseek-reasoner',
        thinking_log: thinking || '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

    if (upsertError) {
      console.error('Error storing results:', upsertError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        pageId: pageData.id,
        schema: schema,
        content: generatedContent,
        thinking: thinking,
        templateSource: templateSource,
        templateSaved: saveAsTemplate ? true : false
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error) {
    console.error('Error in generate-custom-seo-elements:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});