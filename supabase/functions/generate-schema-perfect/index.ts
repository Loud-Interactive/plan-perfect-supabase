// supabase/functions/generate-schema-perfect/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { Groq } from 'npm:groq-sdk'

// Schema type definitions and examples
const SCHEMA_EXAMPLES = {
  Article: {
    description: "Standard article or blog post content",
    example: `{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "How to Build Better Web Applications",
  "author": {
    "@type": "Person",
    "name": "Jane Smith"
  },
  "datePublished": "2024-01-15",
  "dateModified": "2024-01-20",
  "image": "https://example.com/image.jpg",
  "publisher": {
    "@type": "Organization",
    "name": "Tech Blog",
    "logo": {
      "@type": "ImageObject",
      "url": "https://example.com/logo.png"
    }
  },
  "articleBody": "Full article content..."
}`,
    requiredFields: ["headline", "author", "datePublished", "image", "publisher"]
  },
  
  Product: {
    description: "Product pages, e-commerce listings",
    example: `{
  "@context": "https://schema.org",
  "@type": "Product",
  "name": "Ergonomic Office Chair",
  "description": "Comfortable chair for long work hours",
  "image": "https://example.com/chair.jpg",
  "brand": {
    "@type": "Brand",
    "name": "ComfortSeating"
  },
  "offers": {
    "@type": "Offer",
    "price": "299.99",
    "priceCurrency": "USD",
    "availability": "https://schema.org/InStock",
    "url": "https://example.com/product/chair"
  },
  "aggregateRating": {
    "@type": "AggregateRating",
    "ratingValue": "4.5",
    "reviewCount": "89"
  }
}`,
    requiredFields: ["name", "description", "image", "offers"]
  },
  
  Recipe: {
    description: "Cooking recipes and food preparation",
    example: `{
  "@context": "https://schema.org",
  "@type": "Recipe",
  "name": "Classic Chocolate Chip Cookies",
  "image": "https://example.com/cookies.jpg",
  "author": {
    "@type": "Person",
    "name": "Chef Maria"
  },
  "datePublished": "2024-01-10",
  "description": "Delicious homemade cookies",
  "prepTime": "PT15M",
  "cookTime": "PT12M",
  "totalTime": "PT27M",
  "recipeYield": "24 cookies",
  "recipeIngredient": [
    "2 cups flour",
    "1 cup butter",
    "1 cup chocolate chips"
  ],
  "recipeInstructions": [
    {
      "@type": "HowToStep",
      "text": "Preheat oven to 350°F"
    }
  ],
  "aggregateRating": {
    "@type": "AggregateRating",
    "ratingValue": "4.8",
    "ratingCount": "156"
  }
}`,
    requiredFields: ["name", "image", "recipeIngredient", "recipeInstructions"]
  },
  
  HowTo: {
    description: "Tutorial, guide, or instructional content",
    example: `{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "How to Change a Tire",
  "description": "Step-by-step guide to changing a flat tire",
  "image": "https://example.com/tire-change.jpg",
  "totalTime": "PT30M",
  "step": [
    {
      "@type": "HowToStep",
      "name": "Park safely",
      "text": "Pull over to a safe location",
      "image": "https://example.com/step1.jpg"
    },
    {
      "@type": "HowToStep",
      "name": "Get the jack",
      "text": "Retrieve the jack from your trunk",
      "image": "https://example.com/step2.jpg"
    }
  ],
  "tool": [
    {
      "@type": "HowToTool",
      "name": "Car jack"
    },
    {
      "@type": "HowToTool",
      "name": "Lug wrench"
    }
  ]
}`,
    requiredFields: ["name", "step"]
  },
  
  Event: {
    description: "Events, conferences, webinars, concerts",
    example: `{
  "@context": "https://schema.org",
  "@type": "Event",
  "name": "Web Development Conference 2024",
  "description": "Annual gathering of web developers",
  "startDate": "2024-06-15T09:00",
  "endDate": "2024-06-17T18:00",
  "location": {
    "@type": "Place",
    "name": "Convention Center",
    "address": {
      "@type": "PostalAddress",
      "streetAddress": "123 Main St",
      "addressLocality": "San Francisco",
      "addressRegion": "CA",
      "postalCode": "94102",
      "addressCountry": "US"
    }
  },
  "image": "https://example.com/conference.jpg",
  "offers": {
    "@type": "Offer",
    "price": "299",
    "priceCurrency": "USD",
    "availability": "https://schema.org/InStock",
    "url": "https://example.com/tickets"
  },
  "organizer": {
    "@type": "Organization",
    "name": "WebDev Society",
    "url": "https://example.com"
  }
}`,
    requiredFields: ["name", "startDate", "location"]
  },
  
  FAQPage: {
    description: "Frequently asked questions pages",
    example: `{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "What is JSON-LD?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "JSON-LD is a structured data format that helps search engines understand your content."
      }
    },
    {
      "@type": "Question",
      "name": "Why use structured data?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Structured data improves SEO and enables rich snippets in search results."
      }
    }
  ]
}`,
    requiredFields: ["mainEntity"]
  },
  
  VideoObject: {
    description: "Video content pages",
    example: `{
  "@context": "https://schema.org",
  "@type": "VideoObject",
  "name": "How to Use JSON-LD",
  "description": "Complete tutorial on implementing JSON-LD",
  "thumbnailUrl": "https://example.com/thumb.jpg",
  "uploadDate": "2024-01-15",
  "duration": "PT10M30S",
  "contentUrl": "https://example.com/video.mp4",
  "embedUrl": "https://example.com/embed/video",
  "publisher": {
    "@type": "Organization",
    "name": "Tech Tutorials",
    "logo": {
      "@type": "ImageObject",
      "url": "https://example.com/logo.png"
    }
  }
}`,
    requiredFields: ["name", "description", "thumbnailUrl", "uploadDate"]
  },
  
  LocalBusiness: {
    description: "Local business pages, stores, restaurants",
    example: `{
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  "name": "Joe's Coffee Shop",
  "image": "https://example.com/shop.jpg",
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "456 Oak Avenue",
    "addressLocality": "Portland",
    "addressRegion": "OR",
    "postalCode": "97201",
    "addressCountry": "US"
  },
  "telephone": "+1-503-555-0123",
  "priceRange": "$$",
  "openingHoursSpecification": [
    {
      "@type": "OpeningHoursSpecification",
      "dayOfWeek": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
      "opens": "07:00",
      "closes": "19:00"
    }
  ],
  "aggregateRating": {
    "@type": "AggregateRating",
    "ratingValue": "4.7",
    "reviewCount": "234"
  }
}`,
    requiredFields: ["name", "address"]
  }
}

interface PageClassification {
  primaryType: string
  secondaryTypes: string[]
  confidence: number
  reasoning: string
  contentCharacteristics: {
    hasAuthor: boolean
    hasDate: boolean
    hasImages: boolean
    hasVideo: boolean
    hasPrice: boolean
    hasReviews: boolean
    hasSteps: boolean
    hasFAQ: boolean
    hasLocation: boolean
  }
}

function extractRootDomain(url: string): string {
  try {
    let hostname = new URL(url).hostname
    const parts = hostname.split('.')
    if (parts.length > 2) {
      if (parts[0] === 'www') {
        hostname = parts.slice(1).join('.')
      } else {
        const tldParts = parts[parts.length - 1].length <= 3 && parts.length > 2 ? 3 : 2
        hostname = parts.slice(-tldParts).join('.')
      }
    }
    return hostname
  } catch (error) {
    console.error("Error extracting domain:", error)
    return ""
  }
}

async function classifyPageType(
  markdown: string,
  url: string,
  groq: Groq,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder
): Promise<PageClassification> {
  controller.enqueue(encoder.encode("Step 3a: Classifying page type...\n"))
  
  const classificationPrompt = `Analyze this webpage content and classify its type for JSON-LD schema generation.

URL: ${url}

CONTENT:
${markdown.substring(0, 8000)}

Available Schema Types:
- Article: Blog posts, news articles, editorial content
- Product: E-commerce products, items for sale
- Recipe: Cooking recipes, food preparation guides
- HowTo: Tutorials, guides, instructional content
- Event: Conferences, webinars, concerts, meetups
- FAQPage: FAQ pages with questions and answers
- VideoObject: Video content and tutorials
- LocalBusiness: Physical businesses, stores, restaurants

Analyze the content and return a JSON object with:
{
  "primaryType": "the most appropriate schema type",
  "secondaryTypes": ["other applicable types"],
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation",
  "contentCharacteristics": {
    "hasAuthor": boolean,
    "hasDate": boolean,
    "hasImages": boolean,
    "hasVideo": boolean,
    "hasPrice": boolean,
    "hasReviews": boolean,
    "hasSteps": boolean,
    "hasFAQ": boolean,
    "hasLocation": boolean
  }
}

Return ONLY the JSON object, no other text.`

  const response = await groq.chat.completions.create({
    messages: [
      {
        role: "system",
        content: "You are an expert at analyzing web content and determining appropriate schema.org types. Always return valid JSON."
      },
      {
        role: "user",
        content: classificationPrompt
      }
    ],
    model: "openai/gpt-oss-120b",
    temperature: 0.3,
    max_tokens: 1000,
  })

  const classificationText = response.choices[0]?.message?.content || "{}"
  console.log("Classification result:", classificationText)
  
  try {
    const classification = JSON.parse(classificationText) as PageClassification
    controller.enqueue(encoder.encode(`Classified as: ${classification.primaryType} (confidence: ${classification.confidence})\n`))
    controller.enqueue(encoder.encode(`Reasoning: ${classification.reasoning}\n\n`))
    return classification
  } catch (error) {
    console.error("Failed to parse classification:", error)
    // Fallback to Article if parsing fails
    return {
      primaryType: "Article",
      secondaryTypes: [],
      confidence: 0.5,
      reasoning: "Defaulted to Article due to classification parsing error",
      contentCharacteristics: {
        hasAuthor: true,
        hasDate: true,
        hasImages: false,
        hasVideo: false,
        hasPrice: false,
        hasReviews: false,
        hasSteps: false,
        hasFAQ: false,
        hasLocation: false
      }
    }
  }
}

function buildEnhancedPrompt(
  markdown: string,
  url: string,
  classification: PageClassification,
  domainData: {
    synopsis: string
    jsonLdSchemaPostTemplate: string
    jsonLdSchemaGenerationPrompt: string
  }
): string {
  const schemaInfo = SCHEMA_EXAMPLES[classification.primaryType] || SCHEMA_EXAMPLES.Article
  
  // Build examples section with primary and secondary types
  let examplesSection = `\n## SCHEMA TYPE EXAMPLES\n\nPrimary Type: ${classification.primaryType}\n${schemaInfo.example}\n\nRequired fields for ${classification.primaryType}: ${schemaInfo.requiredFields.join(', ')}\n`
  
  if (classification.secondaryTypes.length > 0) {
    examplesSection += `\n## SECONDARY TYPES TO CONSIDER\n`
    classification.secondaryTypes.forEach(type => {
      if (SCHEMA_EXAMPLES[type]) {
        examplesSection += `\n### ${type}\n${SCHEMA_EXAMPLES[type].example}\n`
      }
    })
  }

  // Content characteristics guidance
  const characteristicsGuidance = `\n## CONTENT CHARACTERISTICS DETECTED\n${
    Object.entries(classification.contentCharacteristics)
      .filter(([_, value]) => value)
      .map(([key]) => `- ${key.replace('has', 'Include ')}`)
      .join('\n')
  }\n`

  return `Generate a comprehensive JSON-LD schema for this webpage.

URL: ${url}
Primary Schema Type: ${classification.primaryType}
Confidence: ${classification.confidence}
Classification Reasoning: ${classification.reasoning}

${domainData.synopsis ? `\nDOMAIN CONTEXT:\n${domainData.synopsis}\n` : ''}

${domainData.jsonLdSchemaGenerationPrompt ? `\nDOMAIN-SPECIFIC INSTRUCTIONS:\n${domainData.jsonLdSchemaGenerationPrompt}\n` : ''}

${examplesSection}

${characteristicsGuidance}

## WEBPAGE CONTENT (Markdown)
${markdown}

${domainData.jsonLdSchemaPostTemplate ? `\n## DOMAIN TEMPLATE REFERENCE\n${domainData.jsonLdSchemaPostTemplate}\n` : ''}

## GENERATION INSTRUCTIONS

1. **Use the correct @type**: Generate schema using "${classification.primaryType}" as the primary type
2. **Include all required fields**: Ensure ${schemaInfo.requiredFields.join(', ')} are present
3. **Extract accurate data**: Use actual content from the markdown, don't fabricate
4. **Follow best practices**: 
   - Use absolute URLs for all links and images
   - Include proper date formatting (ISO 8601)
   - Add structured author/publisher information
   - Include breadcrumbs if navigation is present
   - Add aggregate ratings if reviews exist
   - Use proper schema.org vocabulary

5. **Enhance with secondary types**: If applicable, nest or reference secondary schema types identified: ${classification.secondaryTypes.join(', ') || 'none'}

6. **Validation**: Ensure the JSON-LD is valid and follows schema.org specifications

Return ONLY the complete JSON-LD schema code. No explanation, no wrapper text, just valid JSON-LD that can be directly inserted into a <script type="application/ld+json"> tag.`
}

async function streamSchemaGeneration(
  url?: string, 
  outlineGuid?: string, 
  taskId?: string
): Promise<ReadableStream<Uint8Array>> {
  const encoder = new TextEncoder()
  
  return new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode("<processing>\n"))
        
        let postUrl = url;
        
        // Database fetching logic
        if (!postUrl) {
          controller.enqueue(encoder.encode("No direct URL provided. Fetching URL from the database...\n"))
          
          try {
            const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
            const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
            
            if (!supabaseUrl || !supabaseServiceKey) {
              throw new Error("Missing Supabase credentials");
            }
            
            const supabaseClient = createClient(supabaseUrl, supabaseServiceKey);
            
            if (outlineGuid) {
              controller.enqueue(encoder.encode(`Checking content_plan_outlines for GUID: ${outlineGuid}\n`))
              
              const { data: outlineData, error: outlineError } = await supabaseClient
                .from('content_plan_outlines')
                .select('live_post_url')
                .eq('guid', outlineGuid)
                .single();
              
              if (!outlineError && outlineData && outlineData.live_post_url) {
                postUrl = outlineData.live_post_url;
                controller.enqueue(encoder.encode(`Found URL in outlines table: ${postUrl}\n`))
              } else {
                controller.enqueue(encoder.encode(`No URL found in outlines table, checking tasks table for GUID: ${outlineGuid}\n`))
                
                const { data: tasksData, error: tasksError } = await supabaseClient
                  .from('tasks')
                  .select('live_post_url')
                  .eq('content_plan_outline_guid', outlineGuid)
                  .order('created_at', { ascending: false })
                  .limit(1);
                
                if (tasksError) {
                  throw new Error(`Failed to fetch tasks data: ${tasksError.message}`);
                }
                
                if (!tasksData || tasksData.length === 0 || !tasksData[0].live_post_url) {
                  throw new Error(`No live_post_url found for outline ${outlineGuid} in any table`);
                }
                
                postUrl = tasksData[0].live_post_url;
                controller.enqueue(encoder.encode(`Found URL in tasks table: ${postUrl}\n`))
              }
            } else if (taskId) {
              controller.enqueue(encoder.encode(`Checking tasks table for task_id: ${taskId}\n`))
              
              const { data: taskData, error: taskError } = await supabaseClient
                .from('tasks')
                .select('live_post_url')
                .eq('task_id', taskId)
                .single();
              
              if (taskError) {
                throw new Error(`Failed to fetch task data: ${taskError.message}`);
              }
              
              if (!taskData || !taskData.live_post_url) {
                throw new Error(`No live_post_url found for task ${taskId}`);
              }
              
              postUrl = taskData.live_post_url;
              controller.enqueue(encoder.encode(`Found URL in tasks table: ${postUrl}\n`))
            }
          } catch (dbError) {
            controller.enqueue(encoder.encode(`Error fetching URL from database: ${dbError.message}\n`))
            controller.enqueue(encoder.encode("</processing>\n\n"))
            throw dbError;
          }
        }
        
        if (!postUrl) {
          throw new Error("No URL provided or found in the database");
        }
        
        controller.enqueue(encoder.encode(`Starting schema generation for URL: ${postUrl}\n\n`))

        // Step 1: Convert URL to Markdown
        controller.enqueue(encoder.encode("Step 1: Converting URL to Markdown...\n"))
        
        let markdown = ""
        try {
          const markdownerApiUrl = `https://md.dhr.wtf/?url=${encodeURIComponent(postUrl)}`
          const markdownResponse = await fetch(markdownerApiUrl, {
            headers: {
              'Authorization': 'Bearer LWdIbnQ4UXhDc0dwX1BvLXNBSEVaLTI='
            }
          })
          
          if (!markdownResponse.ok) {
            const errorText = await markdownResponse.text()
            throw new Error(`Failed to convert URL to markdown: ${markdownResponse.statusText} - ${errorText}`)
          }

          markdown = await markdownResponse.text()
          controller.enqueue(encoder.encode(`Successfully converted URL to Markdown (${markdown.length} characters)\n\n`))
        } catch (error) {
          console.error("Error converting URL to Markdown:", error)
          controller.enqueue(encoder.encode(`Error converting URL to Markdown: ${error}\n`))
          controller.enqueue(encoder.encode("</processing>\n\n"))
          throw error
        }

        // Step 2: Extract domain data
        controller.enqueue(encoder.encode("Step 2: Extracting domain data...\n"))
        
        let domain = ""
        let synopsis = ""
        let jsonLdSchemaPostTemplate = ""
        let jsonLdSchemaGenerationPrompt = ""
        
        try {
          domain = extractRootDomain(postUrl)
          controller.enqueue(encoder.encode(`Extracted domain: ${domain}\n`))
          
          const ppApiUrl = `https://pp-api.replit.app/pairs/all/${domain}`
          const domainResponse = await fetch(ppApiUrl)
          
          if (!domainResponse.ok) {
            controller.enqueue(encoder.encode(`Warning: Could not fetch domain data (${domainResponse.status}). Continuing with defaults.\n\n`))
          } else {
            const domainData = await domainResponse.json()
            synopsis = domainData.synopsis || ""
            jsonLdSchemaPostTemplate = domainData.JSON_LD_Schema_Post_Template || ""
            jsonLdSchemaGenerationPrompt = domainData.json_ld_schema_generation_prompt || ""
            
            controller.enqueue(encoder.encode(`Domain data retrieved successfully\n\n`))
          }
        } catch (error) {
          console.error("Error extracting domain data:", error)
          controller.enqueue(encoder.encode(`Warning: Error extracting domain data. Continuing with defaults.\n\n`))
        }

        // Initialize Groq client
        const groqApiKey = Deno.env.get('GROQ_API_KEY');
        if (!groqApiKey) {
          throw new Error("GROQ_API_KEY environment variable is not set");
        }
        const groq = new Groq({ apiKey: groqApiKey });

        // Step 3: CLASSIFY THE PAGE
        controller.enqueue(encoder.encode("</processing>\n\n<think>\n"))
        
        const classification = await classifyPageType(markdown, postUrl, groq, controller, encoder)
        
        // Step 4: Generate schema with enhanced prompt
        controller.enqueue(encoder.encode("Step 3b: Generating schema with AI using classified type...\n"))
        
        const enhancedPrompt = buildEnhancedPrompt(
          markdown,
          postUrl,
          classification,
          { synopsis, jsonLdSchemaPostTemplate, jsonLdSchemaGenerationPrompt }
        )
        
        try {
          controller.enqueue(encoder.encode("Sending request to AI...\n"))
          
          const heartbeatInterval = setInterval(() => {
            controller.enqueue(encoder.encode("."));
          }, 3000);

          const chatCompletion = await groq.chat.completions.create({
            messages: [
              {
                role: "system",
                content: `You are an expert SEO specialist focused on creating accurate, comprehensive JSON-LD schema markup. You specialize in ${classification.primaryType} schema and always follow schema.org specifications precisely.`
              },
              {
                role: "user",
                content: enhancedPrompt
              }
            ],
            model: "openai/gpt-oss-120b",
            temperature: 0.4,
            max_tokens: 65536,
            top_p: 1,
            stream: true,
          })

          controller.enqueue(encoder.encode("Receiving and processing response from AI...\n"))
          controller.enqueue(encoder.encode("Workflow complete. Streaming schema to user...\n"))
          controller.enqueue(encoder.encode("</think>\n\n"))
          
          // Stream the schema content
          let chunkCount = 0;
          for await (const chunk of chatCompletion) {
            if (chunk.choices[0]?.delta?.content) {
              const content = chunk.choices[0].delta.content
              controller.enqueue(encoder.encode(content))
              
              chunkCount++;
              if (chunkCount % 10 === 0) {
                await new Promise(resolve => setTimeout(resolve, 5));
              }
            }
          }
          
          clearInterval(heartbeatInterval);
          
          console.log("Completed streaming schema")
        } catch (error) {
          console.error("Error in Groq API generation:", error)
          controller.enqueue(encoder.encode(`Error generating schema: ${error}\n`))
          controller.enqueue(encoder.encode("</think>\n\n"))
          controller.enqueue(encoder.encode("An error occurred during schema generation. Please try again."))
          throw error
        }

        controller.close()
      } catch (error) {
        console.error("Error in streamSchemaGeneration:", error)
        
        try {
          controller.close()
        } catch (closeError) {
          console.error("Error closing controller:", closeError)
        }
      }
    }
  })
}

serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  }

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders, status: 204 })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  
  try {
    const { content_plan_outline_guid, live_post_url, task_id, url } = await req.json()
    
    console.log("Streaming schema generation request received:", { 
      content_plan_outline_guid, 
      task_id, 
      direct_url: url || live_post_url 
    })

    if (!content_plan_outline_guid && !task_id && !url && !live_post_url) {
      return new Response(JSON.stringify({ 
        error: "Either content_plan_outline_guid, task_id, or a URL (live_post_url/url) is required" 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    let postUrl = url || live_post_url
    
    const stream = await streamSchemaGeneration(postUrl, content_plan_outline_guid, task_id)
    
    return new Response(stream, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
      }
    })
  } catch (error) {
    console.error("Error in schema generation streaming API:", error)
    
    return new Response(JSON.stringify({ error: "Failed to process schema generation" }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

