// Custom SEO field generation utilities
// Provides flexible schema-driven content generation from plain English descriptions

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import { callGroqWithLogging } from './groq-logging.ts';

/**
 * Generate SHA-256 hash for caching schema lookups
 */
async function generateHash(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Schema generation prompt for moonshotai/kimi-k2-instruct-0905
 * Converts plain English field descriptions into structured JSON schemas
 */
function buildSchemaGenerationPrompt(description: string): string {
  return `You are a JSON schema generator that converts plain English field descriptions into structured schemas for content generation.

Convert this field description into a JSON schema:

${description}

Requirements:
1. Extract each distinct content type mentioned
2. Identify character/word limits and constraints
3. Note any business unit variations or context requirements
4. Define clear field names (snake_case)
5. Include generation instructions for each field
6. Detect format requirements, style guidelines, and structural needs

Output ONLY valid JSON (no markdown formatting, no code blocks, no explanations).
Return the schema in this exact JSON format:
{
  "fields": {
    "field_name": {
      "type": "string|array|object",
      "description": "Clear description of what to generate",
      "constraints": {
        "max_length": 100,
        "min_length": 10,
        "format": "specific format requirements",
        "style": "tone or style requirements",
        "business_units": ["FX", "HEX"] // if BU-specific,
        "count": 5 // for arrays,
        "structure": "specific structural requirements"
      },
      "examples": ["example output"],
      "generation_priority": 1
    }
  },
  "global_context": {
    "purpose": "overall purpose of this content set",
    "target_audience": "who this content is for",
    "brand_requirements": "any brand-specific needs",
    "complexity_level": "simple|moderate|complex"
  }
}

IMPORTANT: Only include fields that are clearly defined in the description. Do not add extra fields.`;
}

/**
 * Generate or retrieve cached custom field schema
 */
export async function generateOrGetCachedSchema(
  description: string,
  useCache: boolean = true
): Promise<any> {
  const supabaseClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  // Generate hash of description for caching
  const descriptionHash = await generateHash(description.trim());

  if (useCache) {
    // Check cache first
    const { data: cachedSchema, error: cacheError } = await supabaseClient
      .from('custom_seo_schemas')
      .select('generated_schema')
      .eq('schema_hash', descriptionHash)
      .single();

    if (!cacheError && cachedSchema) {
      console.log(`Using cached schema for hash: ${descriptionHash}`);
      
      // Update usage stats
      const { data: currentSchema } = await supabaseClient
        .from('custom_seo_schemas')
        .select('usage_count')
        .eq('schema_hash', descriptionHash)
        .single();
      
      await supabaseClient
        .from('custom_seo_schemas')
        .update({ 
          usage_count: (currentSchema?.usage_count || 0) + 1,
          last_used: new Date().toISOString()
        })
        .eq('schema_hash', descriptionHash);

      return cachedSchema.generated_schema;
    }
  }

  console.log(`Generating new schema with K2 for description: ${description.substring(0, 100)}...`);

  // Generate new schema with moonshotai/kimi-k2-instruct-0905
  try {
    const { response: schemaJson } = await callGroqWithLogging(
      'generate-custom-schema',
      buildSchemaGenerationPrompt(description),
      Deno.env.get('GROQ_API_KEY') || '',
      undefined,
      { 
        modelName: 'moonshotai/kimi-k2-instruct-0905',
        temperature: 0.3, // Lower temperature for more consistent schema generation
        maxTokens: 4000,
        // Explicitly disable reasoning parameters for K2 model
        includeReasoning: undefined,
        reasoningEffort: undefined
      }
    );

    // Parse and validate schema
    let schema;
    try {
      // Clean up the response - K2 might wrap in markdown code blocks
      let cleanedJson = schemaJson.trim();
      
      // Remove markdown code blocks if present
      if (cleanedJson.startsWith('```json')) {
        cleanedJson = cleanedJson.replace(/^```json\n?/, '').replace(/\n?```$/, '');
      } else if (cleanedJson.startsWith('```')) {
        cleanedJson = cleanedJson.replace(/^```\n?/, '').replace(/\n?```$/, '');
      }
      
      // Also try to extract from <schema> tags if present
      const schemaMatch = cleanedJson.match(/<schema>([\s\S]*?)<\/schema>/);
      if (schemaMatch) {
        cleanedJson = schemaMatch[1].trim();
      }
      
      schema = JSON.parse(cleanedJson);
    } catch (parseError) {
      console.error('Failed to parse schema JSON:', parseError);
      console.error('Raw response:', schemaJson);
      throw new Error('Invalid JSON schema generated');
    }

    // Validate schema structure
    if (!schema.fields || typeof schema.fields !== 'object') {
      throw new Error('Invalid schema structure: missing or invalid fields object');
    }

    console.log(`Generated schema with ${Object.keys(schema.fields).length} fields`);

    // Cache the schema
    if (useCache) {
      try {
        await supabaseClient
          .from('custom_seo_schemas')
          .insert({
            schema_hash: descriptionHash,
            description_text: description,
            generated_schema: schema
          });
        console.log(`Cached schema with hash: ${descriptionHash}`);
      } catch (cacheInsertError) {
        console.warn('Failed to cache schema:', cacheInsertError);
        // Continue anyway, caching is not critical
      }
    }

    return schema;
  } catch (error) {
    console.error('Schema generation failed:', error);
    throw new Error(`Custom field schema generation failed: ${error.message}`);
  }
}

/**
 * Build enhanced prompt that includes custom field generation instructions
 */
export function buildEnhancedPrompt(
  basePrompt: string,
  customSchema: any,
  pageContent: string,
  keywords: any[]
): string {
  const fieldInstructions = Object.entries(customSchema.fields).map(([fieldName, fieldDef]: [string, any]) => {
    let instruction = `${fieldName}: ${fieldDef.description}`;
    
    if (fieldDef.constraints) {
      const constraints = [];
      if (fieldDef.constraints.max_length) constraints.push(`max ${fieldDef.constraints.max_length} chars`);
      if (fieldDef.constraints.min_length) constraints.push(`min ${fieldDef.constraints.min_length} chars`);
      if (fieldDef.constraints.count) constraints.push(`${fieldDef.constraints.count} items`);
      if (fieldDef.constraints.format) constraints.push(`format: ${fieldDef.constraints.format}`);
      if (fieldDef.constraints.style) constraints.push(`style: ${fieldDef.constraints.style}`);
      if (fieldDef.constraints.structure) constraints.push(`structure: ${fieldDef.constraints.structure}`);
      
      if (constraints.length > 0) {
        instruction += ` (${constraints.join(', ')})`;
      }
    }

    if (fieldDef.examples && fieldDef.examples.length > 0) {
      instruction += `\nExample: ${fieldDef.examples[0]}`;
    }

    return instruction;
  }).join('\n\n');

  const businessUnitFields = Object.entries(customSchema.fields).filter(([_, fieldDef]: [string, any]) => 
    fieldDef.constraints?.business_units
  );

  let businessUnitInstructions = '';
  if (businessUnitFields.length > 0) {
    businessUnitInstructions = `

BUSINESS UNIT VARIATIONS:
Some fields require different versions for different business units. Generate variations as objects with business unit keys:
${businessUnitFields.map(([fieldName, fieldDef]: [string, any]) => {
  if (Array.isArray(fieldDef.constraints.business_units)) {
    return `${fieldName}: Generate for ${fieldDef.constraints.business_units.join(', ')}`;
  } else if (typeof fieldDef.constraints.business_units === 'object') {
    return `${fieldName}: ${Object.entries(fieldDef.constraints.business_units).map(([bu, tone]) => `${bu}: ${tone}`).join(', ')}`;
  }
  return `${fieldName}: Business unit specific variations required`;
}).join('\n')}`;
  }

  return `${basePrompt}

ADDITIONAL CUSTOM CONTENT GENERATION:

You must ALSO generate custom content fields based on this schema:

GLOBAL CONTEXT:
Purpose: ${customSchema.global_context?.purpose || 'Custom content generation'}
Target Audience: ${customSchema.global_context?.target_audience || 'General audience'}
${customSchema.global_context?.brand_requirements ? `Brand Requirements: ${customSchema.global_context.brand_requirements}` : ''}

CUSTOM FIELDS TO GENERATE:
${fieldInstructions}${businessUnitInstructions}

GENERATION REQUIREMENTS:
1. Follow ALL constraints specified for each field (character limits, format requirements, etc.)
2. Use the appropriate tone/style for business unit variations
3. Integrate keywords naturally where relevant to the custom fields
4. Maintain brand consistency with existing content
5. Ensure custom content complements but doesn't duplicate standard SEO elements
6. For array fields, generate the exact number of items specified
7. For object fields with business units, create separate versions for each unit

Generate the custom content and wrap it in <custom_seo_data> tags using this exact JSON structure:

<custom_seo_data>
{
${Object.keys(customSchema.fields).map(fieldName => {
  const fieldDef = customSchema.fields[fieldName];
  if (fieldDef.type === 'array') {
    return `  "${fieldName}": ["item1", "item2", "item3"]`;
  } else if (fieldDef.constraints?.business_units) {
    return `  "${fieldName}": {
    "FX": "business unit specific content",
    "HEX": "business unit specific content"
  }`;
  } else {
    return `  "${fieldName}": "generated content here"`;
  }
}).join(',\n')}
}
</custom_seo_data>

Your response must include BOTH the standard SEO elements AND the custom_seo_data block.
CRITICAL: The custom_seo_data must be valid JSON and contain ALL fields from the schema.`;
}

/**
 * Extract custom SEO data from model response
 */
export function extractCustomSeoData(content: string): any {
  const customDataRegex = /<custom_seo_data>([\s\S]*?)<\/custom_seo_data>/s;
  const match = content.match(customDataRegex);
  
  if (match && match[1]) {
    try {
      const jsonStr = match[1].trim();
      const customData = JSON.parse(jsonStr);
      console.log(`Extracted custom SEO data with ${Object.keys(customData).length} fields`);
      return customData;
    } catch (error) {
      console.error('Failed to parse custom SEO data JSON:', error);
      console.error('Raw content:', match[1]);
      return null;
    }
  }
  
  console.warn('No custom SEO data found in response');
  return null;
}

/**
 * Validate custom field output against schema
 */
export function validateCustomFields(customData: any, schema: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!customData) {
    return { valid: false, errors: ['No custom data generated'] };
  }

  // Check all required fields are present
  for (const [fieldName, fieldDef] of Object.entries(schema.fields)) {
    if (!customData.hasOwnProperty(fieldName)) {
      errors.push(`Missing required field: ${fieldName}`);
      continue;
    }

    const fieldValue = customData[fieldName];
    const constraints = (fieldDef as any).constraints || {};

    // Type validation
    if ((fieldDef as any).type === 'array' && !Array.isArray(fieldValue)) {
      errors.push(`Field ${fieldName} should be an array`);
    } else if ((fieldDef as any).type === 'string' && typeof fieldValue !== 'string') {
      errors.push(`Field ${fieldName} should be a string`);
    } else if ((fieldDef as any).type === 'object' && typeof fieldValue !== 'object') {
      errors.push(`Field ${fieldName} should be an object`);
    }

    // Length validation for strings
    if (typeof fieldValue === 'string') {
      if (constraints.max_length && fieldValue.length > constraints.max_length) {
        errors.push(`Field ${fieldName} exceeds max length (${fieldValue.length} > ${constraints.max_length})`);
      }
      if (constraints.min_length && fieldValue.length < constraints.min_length) {
        errors.push(`Field ${fieldName} below min length (${fieldValue.length} < ${constraints.min_length})`);
      }
    }

    // Array count validation
    if (Array.isArray(fieldValue) && constraints.count) {
      if (fieldValue.length !== constraints.count) {
        errors.push(`Field ${fieldName} should have exactly ${constraints.count} items (has ${fieldValue.length})`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Store enhanced SEO results including custom fields
 * Also exported as storeCustomSeoData for backward compatibility
 */
export async function storeEnhancedSEOResults({
  pageId,
  standardSEO,
  customSEO,
  customSchema,
  customFieldsHash,
  thinking
}: {
  pageId: string;
  standardSEO: any;
  customSEO: any;
  customSchema: any;
  customFieldsHash?: string;
  thinking: string;
}): Promise<void> {
  const supabaseClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  try {
    // Get the page URL
    const { data: pageData, error: pageError } = await supabaseClient
      .from('pages')
      .select('url')
      .eq('id', pageId)
      .single();
      
    if (pageError || !pageData?.url) {
      throw new Error(`Error getting page URL: ${pageError?.message || 'Page not found'}`);
    }

    const updateData: any = {
      title: standardSEO.title,
      meta_description: standardSEO.metaDescription,
      h1: standardSEO.h1,
      h2: standardSEO.h2,
      h4: standardSEO.h4,
      paragraph: standardSEO.paragraph,
      primary_keyword: standardSEO.primaryKeyword,
      secondary_keyword: standardSEO.secondaryKeyword,
      tertiary_keyword: standardSEO.tertiaryKeyword,
      thinking_log: thinking,
      updated_at: new Date().toISOString(),
      generation_type: customSEO ? 'enhanced' : 'standard'
    };

    // Add custom fields if present
    if (customSEO) {
      updateData.custom_seo_data = customSEO;
      updateData.custom_schema = customSchema;
      updateData.custom_fields_hash = customFieldsHash;
    }

    // Check if record exists
    const { data: existingRecords, error: checkError } = await supabaseClient
      .from('page_seo_recommendations')
      .select('id')
      .eq('page_id', pageId);
    
    if (checkError) {
      throw new Error(`Error checking for existing record: ${checkError.message}`);
    }
    
    if (existingRecords && existingRecords.length > 0) {
      // Update existing record
      const recordId = existingRecords[0].id;
      console.log(`Updating existing record ${recordId} for page ${pageId}`);
      
      const { error: updateError } = await supabaseClient
        .from('page_seo_recommendations')
        .update(updateData)
        .eq('id', recordId);
        
      if (updateError) {
        throw new Error(`Update error: ${updateError.message}`);
      }
      
      console.log(`Successfully updated enhanced SEO record for ${pageId}`);
    } else {
      // Insert new record
      console.log(`Creating new enhanced SEO record for ${pageId}`);
      const insertData = {
        page_id: pageId,
        url: pageData.url,
        created_at: new Date().toISOString(),
        ...updateData
      };
      
      const { error: insertError } = await supabaseClient
        .from('page_seo_recommendations')
        .insert(insertData);
        
      if (insertError) {
        throw new Error(`Insert error: ${insertError.message}`);
      }
      
      console.log(`Successfully inserted enhanced SEO record for ${pageId}`);
    }
  } catch (error) {
    console.error(`Error storing enhanced SEO results: ${error.message}`);
    throw error;
  }
}

// Alias for backward compatibility
export const storeCustomSeoData = storeEnhancedSEOResults;