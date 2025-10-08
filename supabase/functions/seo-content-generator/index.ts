import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import { callDeepSeekWithLogging } from '../utils/model-logging.ts';

const FUNCTION_NAME = 'seo-content-generator';

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

interface ContentGeneratorRequest {
  workflowId: string;
}

interface ContentGeneratorResponse {
  success: boolean;
  workflowId: string;
  contentGenerated?: boolean;
  nextStep?: string;
  error?: string;
}

interface DataShapeField {
  name: string;
  description: string;
  maxLength?: number;
  type?: string;
  businessUnits?: string[];
  required?: boolean;
  arraySize?: number;
}

interface DataShapeSchema {
  fields: DataShapeField[];
  businessUnits?: {
    [key: string]: string;
  };
  instructions?: string;
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
  keywords: any[],
  businessUnit: string | undefined,
  apiKey: string
): Promise<{ content: any; thinking: string }> {
  try {
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
      if (field.type === 'array') {
        desc += ` (provide as array with ${field.arraySize || 'multiple'} items)`;
      }
      if (field.businessUnits && businessUnit) {
        desc += ` (for ${businessUnit} brand)`;
      }
      return desc;
    }).join('\n');

    // Prepare keyword list
    const keywordList = keywords?.map(k => k.keyword || k).filter(Boolean).join(', ') || 'No keywords available';

    const userPrompt = `Generate SEO content for the following page:
URL: ${pageData.url}
Current Title: ${pageData.title || 'N/A'}
Current Description: ${pageData.meta_description || 'N/A'}

⚠️ **Today's date is ${today}.** Update any dates to be current and relevant.

${businessUnit ? `Business Unit: ${businessUnit} (${schema.businessUnits?.[businessUnit] || businessUnit})` : ''}

Generate content for these fields:
${fieldDescriptions}

Page Content Summary:
${pageData.content_summary || pageData.h1 || pageData.title || 'Product page'}

Keywords: ${keywordList}

**CRITICAL REQUIREMENTS:**
1. Each business unit MUST have completely UNIQUE content - no duplicates or near-duplicates
2. Use different keywords, phrasing, and angles for each business unit
3. Tailor to each brand's specific voice and target audience
4. Ensure all content adheres to character limits
5. Include relevant keywords naturally throughout

Return ONLY the JSON object wrapped in <results> tags. Do not include any markdown formatting or code blocks.

Example format:
<results>
{
  "fieldName": "value",
  "anotherField": "another value"
}
</results>

Ensure all content is SEO-optimized, includes relevant keywords naturally, and adheres to character limits.`;

    // Call DeepSeek with logging
    const metadata = {
      pageId: pageData.id || null,
      url: pageData.url,
      businessUnit: businessUnit || null,
      schemaFieldCount: schema.fields.length,
      keywordCount: keywords?.length || 0
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

// Process a single workflow
async function processWorkflow(workflowId: string): Promise<ContentGeneratorResponse> {
  try {
    console.log(`Processing content generation for workflow: ${workflowId}`);
    
    // Get workflow details
    const { data: workflow, error: fetchError } = await supabase
      .from('seo_workflows')
      .select('*')
      .eq('id', workflowId)
      .single();
    
    if (fetchError) {
      console.error('Error fetching workflow:', fetchError);
      throw fetchError;
    }
    
    if (!workflow) {
      throw new Error('Workflow not found');
    }
    
    // Update status to generating
    await supabase.rpc('update_workflow_status', {
      workflow_id: workflowId,
      new_status: 'generating',
      step_name: 'content-generator'
    });
    
    // Get page details if we have a page_id
    let pageData = {
      id: workflow.page_id,
      url: workflow.url,
      title: '',
      meta_description: '',
      h1: '',
      domain: new URL(workflow.url).hostname
    };
    
    if (workflow.page_id) {
      const { data, error } = await supabase
        .from('pages')
        .select('*')
        .eq('id', workflow.page_id)
        .single();
      
      if (!error && data) {
        pageData = data;
      }
    }
    
    // Get schema based on data_shape
    let schema: DataShapeSchema;
    if (workflow.data_shape === 'oriental trading' || !workflow.data_shape) {
      schema = parseOrientalTradingShape();
    } else {
      throw new Error(`Unsupported data shape: ${workflow.data_shape}`);
    }
    
    // Prepare enriched page data
    const enrichedPageData = {
      ...pageData,
      ...workflow.existing_data,
      content_summary: pageData.h1 || pageData.title || workflow.existing_data?.productName || 'Product page'
    };
    
    console.log(`Generating content for URL: ${workflow.url}`);
    console.log(`Using ${workflow.keywords?.length || 0} keywords for optimization`);
    
    // Generate content
    const { content: generatedContent, thinking } = await generateCustomContent(
      schema,
      enrichedPageData,
      workflow.keywords || [],
      workflow.business_unit,
      DEEPSEEK_API_KEY!
    );
    
    // Update workflow with generated content
    await supabase
      .from('seo_workflows')
      .update({ 
        generated_content: generatedContent,
        workflow_metadata: {
          ...workflow.workflow_metadata,
          thinking_log: thinking,
          content_generated_at: new Date().toISOString()
        },
        updated_at: new Date().toISOString()
      })
      .eq('id', workflowId);
    
    console.log(`Content generated successfully for workflow ${workflowId}`);
    
    // Move to next step
    await triggerNextStep(workflowId, 'saving');
    
    return {
      success: true,
      workflowId: workflowId,
      contentGenerated: true,
      nextStep: 'saving'
    };
    
  } catch (error) {
    console.error(`Error processing content generation for workflow ${workflowId}:`, error);
    
    // Mark workflow as failed
    await supabase.rpc('update_workflow_status', {
      workflow_id: workflowId,
      new_status: 'failed',
      error_msg: error.message
    });
    
    return {
      success: false,
      workflowId: workflowId,
      error: error.message
    };
  }
}

// Trigger next step in workflow
async function triggerNextStep(workflowId: string, nextStep: string) {
  try {
    console.log(`Triggering next step: ${nextStep} for workflow ${workflowId}`);
    
    // Update workflow status
    await supabase.rpc('update_workflow_status', {
      workflow_id: workflowId,
      new_status: nextStep,
      step_name: nextStep
    });
    
    // Call the content saver function
    const response = await fetch(`${supabaseUrl}/functions/v1/seo-content-saver`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseServiceKey}`
      },
      body: JSON.stringify({ workflowId })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to trigger content saver: ${errorText}`);
    }
    
  } catch (error) {
    console.error('Error triggering next step:', error);
    
    // Mark workflow as failed
    await supabase.rpc('update_workflow_status', {
      workflow_id: workflowId,
      new_status: 'failed',
      error_msg: `Failed to trigger next step: ${error.message}`
    });
  }
}

// Main handler
serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const request: ContentGeneratorRequest = await req.json();
    const { workflowId } = request;
    
    if (!workflowId) {
      throw new Error('workflowId is required');
    }
    
    if (!DEEPSEEK_API_KEY) {
      throw new Error('DeepSeek API key is not configured');
    }
    
    console.log(`=== SEO Content Generator - Processing Workflow ${workflowId} ===`);
    
    const response = await processWorkflow(workflowId);
    
    return new Response(
      JSON.stringify(response),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: response.success ? 200 : 400,
      }
    );

  } catch (error) {
    console.error('Error in seo-content-generator:', error);
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