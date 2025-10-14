// Schema generator - uses Groq gpt-oss-120b to generate comprehensive JSON-LD schema
// Generates SEO-optimized structured data from markdown content

import { Groq } from 'npm:groq-sdk';

export interface SchemaGenerationOptions {
  markdown: string;
  postTitle: string;
  domain: string;
  groqApiKey: string;
  synopsis?: string;
  jsonLdSchemaPostTemplate?: string;
  jsonLdSchemaGenerationPrompt?: string;
}

export interface SchemaGenerationResult {
  schema: string; // JSON string
  reasoning: string;
  success: boolean;
  error?: string;
}

/**
 * Generate JSON-LD schema from markdown content using Groq AI
 */
export async function generateSchema(options: SchemaGenerationOptions): Promise<SchemaGenerationResult> {
  console.log('[SchemaGenerator] Starting schema generation...');

  try {
    const {
      markdown,
      postTitle,
      domain,
      groqApiKey,
      synopsis = '',
      jsonLdSchemaPostTemplate = '',
      jsonLdSchemaGenerationPrompt = ''
    } = options;

    // Initialize Groq client
    const groq = new Groq({
      apiKey: groqApiKey,
    });

    // Get current date and time
    const currentDate = new Date();
    const formattedDate = currentDate.toISOString();

    // Construct the URL from domain and title
    const slugifiedTitle = postTitle
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');
    const postUrl = `https://${domain}/${slugifiedTitle}/`;

    console.log(`[SchemaGenerator] Generating schema for: ${postUrl}`);

    // Construct the comprehensive prompt
    const prompt = `
I want you to create a JSON-LD schema for this article.

Here is the url: ${postUrl}

Here's the markdown content of the article:

${markdown}

Ensure that you use the domain from the url to generate the schema.

Ensure that you use the content from the markdown to generate the schema.

Today's date is: ${formattedDate}
IMPORTANT: You MUST use today's date (${formattedDate}) for ALL date fields in the schema, including datePublished, dateModified, and any other date fields.

${jsonLdSchemaGenerationPrompt ? `Additional guidance for schema generation: ${jsonLdSchemaGenerationPrompt}` : ""}

Create a detailed JSON-LD schema markup that accurately represents the content and enhances SEO. The schema should be valid and follow best practices for structured data.
${jsonLdSchemaPostTemplate ? `Use this template as a starting point (but adapt it to the content): ${jsonLdSchemaPostTemplate}` : ""}

ensure that you consider all of these schema elements even if they aren't in the template:
Basic Information
* \`@context\` (required)
* \`@type\` (BlogPosting)

Essential Article Properties
* \`headline\`
* \`alternativeHeadline\`
  * \`image\` *(can be ImageObject or URL string)*\`url\`
  * \`height\`
  * \`width\`
  * \`caption\`
  * \`author@type\` *(Person or Organization)*
  * \`name\`
  * \`url\`
  * \`sameAs\`
  * \`email\`
  * \`telephone\`
  * \`image\`
  * \`editor@type\`
  * \`name\`
  * \`publisher@type\` *(Organization)*
  * \`name\`
    * \`logo@type\` *(ImageObject)*
    * \`url\`
    * \`width\`
  * \`height\`
* \`datePublished\`
* \`dateModified\`
  * \`mainEntityOfPage@type\` *(WebPage)*
  * \`@id\` *(URL of the canonical article page)*
* \`description\`
* \`keywords\`
* \`genre\`
* \`articleBody\`
* \`articleSection\` *(array for multiple sections/topics)*

Metadata & Content Attributes
* \`abstract\`
* \`wordCount\`
  * \`publisher@type\` *(Organization)*
  * \`name\`
  * \`logo\`
* \`inLanguage\`
* \`url\` *(Canonical URL of the blog post)*

Content-related properties:
* \`about@type\` *(Thing, e.g., Bread, Knife, Culinary Arts, etc.)*
* \`name\`
* \`url\`
* \`mentions@type\` *(Thing/Product/Person)*
* \`name\`
* \`sameAs\` *(Wikipedia or authoritative link)*
* \`url\`
* \`citation@type\` *(CreativeWork or URL)*
* \`name\`
* \`url\`
* \`keywords\` *(comma-separated list)*
* \`genre\`
* \`articleSection\` *(sections/sub-sections of the blog post)*

Structural properties:
* \`wordCount\`
* \`timeRequired\` *(ISO 8601 duration, e.g., "PT5M")*
* \`isAccessibleForFree\`
  * \`isPartOf@type\` *(Blog, Series, PublicationVolume)*
  * \`name\`
  * \`url\`
* \`isPartOf\` *(used for Blog, WebSite, or WebPage)*

Social interaction properties:
* \`interactionStatistic@type\` *(InteractionCounter)*
* \`interactionType@type\` *(e.g., CommentAction, LikeAction, ShareAction)*
* \`userInteractionCount\`
* \`commentCount\`
* \`comment@type\` *(Comment)*
* \`author\`
* \`datePublished\`
* \`text\`

Publisher or author details (optional but comprehensive):
* \`publisher@type\` *(Organization)*
* \`name\`
* \`url\`
* \`telephone\`
* \`address\`
* \`sameAs\`
* \`contactPoint@type\`: ContactPoint
* \`telephone\`
* \`contactType\`
* \`author\` *(expanded)*\`jobTitle\`
* \`email\`
* \`telephone\`
* \`sameAs\` *(Social media profiles)*
* \`address@type\` *(PostalAddress)*
* \`addressLocality\`
* \`addressRegion\`
* \`addressCountry\`

Breadcrumb & Navigation:
* \`breadcrumb@type\`: BreadcrumbList
* \`itemListElement\` *(Array of ListItems)*\`@type\`: ListItem
* \`position\` *(numeric)*
* \`name\`
* \`item\`

Related content (articles and blog posts):
* \`isPartOf@type\`: Blog or CreativeWorkSeries
* \`name\`
* \`url\`

Publishing principles & ethics:
* \`publishingPrinciples\`URL or CreativeWork outlining editorial policies and standards


IMPORTANT: Return ONLY the raw JSON-LD schema. Do not wrap it in code blocks with backticks, and do not surround it with any tags. Just return the pure, valid JSON object.`;

    console.log('[SchemaGenerator] Calling Groq API with reasoning...');

    // Call the Groq API for schema generation with reasoning enabled
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: "You are an expert SEO specialist focused on creating JSON-LD schema markup."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      model: "openai/gpt-oss-120b",
      temperature: 0.6,
      max_completion_tokens: 65536,
      top_p: 0.95,
      reasoning_effort: "high", // High reasoning for complex schema generation
      include_reasoning: true
    });

    const llmContent = chatCompletion.choices[0]?.message?.content || "";
    const reasoning = chatCompletion.choices[0]?.message?.reasoning || "";

    console.log(`[SchemaGenerator] Generated schema with reasoning (${reasoning.length} chars of reasoning)`);

    // Extract schema from content - handling multiple possible formats
    let schemaContent = "";

    // First, remove any <think> tags and content between them
    const withoutThinkingTags = llmContent.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

    // Try to extract from <schema> tags
    const schemaTagMatch = withoutThinkingTags.match(/<schema>([\s\S]*?)<\/schema>/i);
    if (schemaTagMatch && schemaTagMatch[1]) {
      schemaContent = schemaTagMatch[1].trim();
    }
    // Then, try to extract from ```json code blocks
    else {
      const jsonCodeBlockMatch = withoutThinkingTags.match(/```json\s*([\s\S]*?)```/i);
      if (jsonCodeBlockMatch && jsonCodeBlockMatch[1]) {
        schemaContent = jsonCodeBlockMatch[1].trim();
      }
      // If no code block with json explicitly specified, try any code block
      else {
        const codeBlockMatch = withoutThinkingTags.match(/```\s*([\s\S]*?)```/i);
        if (codeBlockMatch && codeBlockMatch[1]) {
          schemaContent = codeBlockMatch[1].trim();
        }
        // Try to find a standalone JSON object
        else {
          const jsonObjectMatch = withoutThinkingTags.match(/(\{[\s\S]*\})/g);
          if (jsonObjectMatch && jsonObjectMatch.length > 0) {
            // Use the first match as it's most likely to be the complete schema
            schemaContent = jsonObjectMatch[0].trim();
          }
          // If nothing else works, just use the raw content without thinking tags
          else {
            schemaContent = withoutThinkingTags.trim();
          }
        }
      }
    }

    // Fix common JSON formatting issues
    schemaContent = schemaContent
      // Fix trailing commas before closing bracket
      .replace(/,(\s*[\]}])/g, '$1')
      // Fix any duplicate closing brackets at the end
      .replace(/\}\s*\}+\s*$/, '}');

    // Validate that we have valid JSON
    try {
      // Parse and re-stringify to ensure proper formatting
      const jsonObj = JSON.parse(schemaContent);
      schemaContent = JSON.stringify(jsonObj);
      console.log(`[SchemaGenerator] Successfully parsed and validated JSON schema`);
    } catch (jsonError) {
      console.warn(`[SchemaGenerator] Warning: Could not validate schema as JSON: ${jsonError.message}`);
      // Try fixing JSON by removing everything after the last valid closing brace
      try {
        const lastBrace = schemaContent.lastIndexOf('}');
        if (lastBrace > 0) {
          const truncatedContent = schemaContent.substring(0, lastBrace + 1);
          const jsonObj = JSON.parse(truncatedContent);
          schemaContent = JSON.stringify(jsonObj);
          console.log(`[SchemaGenerator] Fixed JSON by truncating after last closing brace`);
        }
      } catch (fixError) {
        console.warn(`[SchemaGenerator] Could not fix JSON: ${fixError.message}`);
        // Keep the extracted content as is
      }
    }

    console.log(`[SchemaGenerator] Generated schema, length: ${schemaContent.length}`);

    return {
      schema: schemaContent,
      reasoning,
      success: true
    };

  } catch (error) {
    console.error('[SchemaGenerator] Error generating schema:', error);
    return {
      schema: '',
      reasoning: '',
      success: false,
      error: error.message
    };
  }
}
