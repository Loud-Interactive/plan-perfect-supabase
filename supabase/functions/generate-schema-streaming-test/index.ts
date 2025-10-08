// supabase/functions/generate-schema-stream/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { Groq } from 'npm:groq-sdk'

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

async function streamSchemaGeneration(
  url?: string, 
  outlineGuid?: string, 
  taskId?: string
): Promise<ReadableStream<Uint8Array>> {
  const encoder = new TextEncoder()
  
  return new ReadableStream({
    async start(controller) {
      try {
        // Start the processing phase
        controller.enqueue(encoder.encode("<processing>\n"))
        
        // If the URL was directly provided, we can skip fetching it
        let postUrl = url;
        
        // If no URL was provided, try to fetch it from the database
        if (!postUrl) {
          controller.enqueue(encoder.encode("No direct URL provided. Fetching URL from the database...\n"))
          
          try {
            // Initialize Supabase client
            const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
            const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
            
            if (!supabaseUrl || !supabaseServiceKey) {
              throw new Error("Missing Supabase credentials");
            }
            
            const supabaseClient = createClient(supabaseUrl, supabaseServiceKey);
            
            if (outlineGuid) {
              // First try to fetch URL from content_plan_outlines table
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
                // If not found in outlines, check tasks table
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
              // Fetch URL from tasks table using task_id
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

        // Step 1: Convert URL to Markdown using Markdowner API
        controller.enqueue(encoder.encode("Step 1: Converting URL to Markdown...\n"))
        
        let markdown = ""
        try {
          console.log("Calling Markdowner API:", `https://md.dhr.wtf/?url=${encodeURIComponent(postUrl)}`)
          const markdownerApiUrl = `https://md.dhr.wtf/?url=${encodeURIComponent(postUrl)}`
          const markdownResponse = await fetch(markdownerApiUrl, {
            headers: {
              'Authorization': 'Bearer LWdIbnQ4UXhDc0dwX1BvLXNBSEVaLTI='
            }
          })

          console.log("Received response from Markdowner API, status:", markdownResponse.status)
          
          if (!markdownResponse.ok) {
            const errorText = await markdownResponse.text()
            console.error("Markdowner API error:", markdownResponse.status, errorText)
            throw new Error(`Failed to convert URL to markdown: ${markdownResponse.statusText} - ${errorText}`)
          }

          markdown = await markdownResponse.text()
          console.log("Markdown content length:", markdown.length)
          
          console.log("Converted URL to Markdown successfully")
          controller.enqueue(encoder.encode(`Successfully converted URL to Markdown (${markdown.length} characters)\n\n`))
        } catch (error) {
          console.error("Error converting URL to Markdown:", error)
          controller.enqueue(encoder.encode(`Error converting URL to Markdown: ${error}\n`))
          controller.enqueue(encoder.encode("</processing>\n\n"))
          throw error
        }

        // Step 2: Extract domain data using the Domain Data API
        controller.enqueue(encoder.encode("Step 2: Extracting domain preferencesPerfect data...\n"))
        
        let domain = ""
        let synopsis = ""
        let jsonLdSchemaPostTemplate = ""
        let jsonLdSchemaGenerationPrompt = ""
        
        try {
          // Extract the root domain
          domain = extractRootDomain(postUrl)
          console.log("Extracted domain:", domain)
          controller.enqueue(encoder.encode(`Extracted domain: ${domain}\n`))
          
          console.log("Calling PP API:", `https://pp-api.replit.app/pairs/all/${domain}`)
          const ppApiUrl = `https://pp-api.replit.app/pairs/all/${domain}`
          const domainResponse = await fetch(ppApiUrl)
          
          console.log("Received response from PP API, status:", domainResponse.status)
          
          if (!domainResponse.ok) {
            const errorText = await domainResponse.text()
            console.error("PP API error:", domainResponse.status, errorText)
            throw new Error(`Failed to fetch domain data: ${domainResponse.statusText} - ${errorText}`)
          }
          
          const domainData = await domainResponse.json()
          console.log("Domain data received:", Object.keys(domainData))
          
          // Extract useful information
          synopsis = domainData.synopsis || ""
          jsonLdSchemaPostTemplate = domainData.JSON_LD_Schema_Post_Template || ""
          jsonLdSchemaGenerationPrompt = domainData.json_ld_schema_generation_prompt || ""
          
          console.log("Extracted domain data successfully")
          controller.enqueue(encoder.encode(`Domain preferencesPerfect data retrieved successfully\n`))
          controller.enqueue(encoder.encode(`Synopsis: ${synopsis.substring(0, 100)}...\n`))
          controller.enqueue(encoder.encode(`Schema template and generation prompt obtained\n\n`))
        } catch (error) {
          console.error("Error extracting domain data:", error)
          controller.enqueue(encoder.encode(`Error extracting domain data: ${error}\n`))
          controller.enqueue(encoder.encode("</processing>\n\n"))
          throw error
        }

        // End processing phase and start AI thinking phase
        controller.enqueue(encoder.encode("</processing>\n\n<think>\n"))
        controller.enqueue(encoder.encode("Step 3: Generating schema with AI...\n"))
        
        try {
          // Initialize Groq client
          console.log("Initializing Groq client")
          const groq = new Groq({
            apiKey: Deno.env.get('GROQ_API_KEY'),
          })
          
          // Get current date and time
          const currentDate = new Date();
          const formattedDate = currentDate.toISOString();
          
          // Construct the prompt
          const prompt = `
I want you to create a JSON-LD schema for this article. 

⚠️ CRITICAL INSTRUCTIONS - READ CAREFULLY:

1. **ONLY INCLUDE FIELDS THAT ARE DIRECTLY SUPPORTED BY THE ACTUAL CONTENT**
   - DO NOT make up or invent details that aren't in the article
   - DO NOT add placeholder values or generic information
   - DO NOT include fields just because they're in the schema template
   - Every field you include MUST have supporting evidence in the provided content

2. **EXAMPLES OF WHAT NOT TO DO:**
   ❌ BAD: Adding "author": {"name": "John Doe"} when no author is mentioned
   ❌ BAD: Including "reviewRating" when the article isn't a review
   ❌ BAD: Adding "video" objects when no videos are present
   ❌ BAD: Including "offers" when there's no product/pricing information
   ❌ BAD: Making up social media URLs that aren't mentioned
   ❌ BAD: Inventing contact information not present in the content

3. **EXAMPLES OF WHAT TO DO:**
   ✅ GOOD: Extract the actual headline from the article's title
   ✅ GOOD: Use images that are actually present in the content
   ✅ GOOD: Only include author details if explicitly mentioned
   ✅ GOOD: Extract keywords from the actual content themes
   ✅ GOOD: Leave out optional fields if data isn't available

4. **DOMAIN PREFERENCES DATA:**
${synopsis ? `   - Company Synopsis: ${synopsis}` : '   - No company synopsis available'}
${jsonLdSchemaPostTemplate ? `   - Template (use as guide but ONLY include fields with actual data): ${jsonLdSchemaPostTemplate}` : '   - No template provided'}
${jsonLdSchemaGenerationPrompt ? `   - Additional Instructions: ${jsonLdSchemaGenerationPrompt}` : ''}

5. **CONTENT TO ANALYZE:**
   URL: ${postUrl}
   
   MARKDOWN CONTENT:
   ${markdown}

6. **STRICT REQUIREMENTS:**
   - @context and @type are REQUIRED
   - headline is REQUIRED (extract from actual title)
   - datePublished and dateModified: Use ${formattedDate}
   - For ALL other fields: ONLY include if you can extract or infer from the actual content
   - It's better to have a minimal, accurate schema than a comprehensive but inaccurate one

7. **VALIDATION CHECKLIST FOR EACH FIELD:**
   Before including ANY field, ask yourself:
   - Can I point to specific text in the content that supports this value?
   - Am I extracting this from the actual content, not inventing it?
   - Is this field relevant to the type of content I'm analyzing?

Remember: Quality over quantity. A schema with 10 accurate fields is infinitely better than one with 50 fields where 40 are made up.

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

Multimedia content:
* \`video@type\` *(VideoObject)*
* \`contentUrl\`
* \`embedUrl\`
* \`uploadDate\`
* \`duration\`
* \`description\`
* \`audio@type\` *(AudioObject)*
* \`contentUrl\`
* \`duration\`
* \`embedUrl\`
* \`associatedMedia\` *(additional images or videos)*\`@type\` *(MediaObject, ImageObject, VideoObject, etc.)*
* \`contentUrl\`
* \`caption\`

Referenced content:
* \`citation@type\`: CreativeWork
* \`name\`
* \`url\`
* \`mentions@type\`: *(Thing/Product/Event/CreativeWork/Organization)*
* \`name\`
* \`sameAs\` or \`url\`

Specialized structured data for content navigation:
* \`hasPart@type\`: *(CreativeWork or WebPageElement)*
* \`name\`
* \`url\` *(anchors to sections of the blog post)*
* \`position\` (numeric order or position)
* \`exampleOfWork@type\`: *(CreativeWork)*
* \`name\`
* \`url\`

Referencing/Citation:
* \`citation@type\`: CreativeWork
* \`name\`
* \`author\`
* \`datePublished\`
* \`url\`

Review & Rating:
* \`review@type\`: Review
* \`reviewRating@type\`: Rating
* \`ratingValue\`
* \`bestRating\`
* \`worstRating\`
* \`author\`
* \`datePublished\`
* \`reviewBody\`

Call to Action & Offer:
* \`offers@type\`: Offer
* \`price\`
* \`priceCurrency\`
* \`url\`
* \`availability\`

Publisher details (expanded):
* \`publisher@type\`: Organization
* \`name\`
* \`founder\`
* \`foundingDate\`
* \`url\`
* \`sameAs\`
* \`logo\`
* \`address\`
* \`contactPoint\`

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

**FINAL REMINDER:**
The list above shows POSSIBLE fields you could include, but you should ONLY include fields where you have actual data from the content or domain preferences. DO NOT feel obligated to include all fields listed above.

**OUTPUT INSTRUCTIONS:**
Return ONLY the JSON-LD schema code. No explanation, no wrapper text, just the complete JSON-LD schema markup.

Remember: Every single field in your output (except required fields like @context and @type) must be traceable back to specific content in the article or domain preferences data. If you cannot find evidence for a field, DO NOT include it.
`

          console.log("Sending request to Groq API")
          controller.enqueue(encoder.encode("Sending request to AI...\n"))
          
          // Send a heartbeat every few seconds to keep the connection alive
          const heartbeatInterval = setInterval(() => {
            controller.enqueue(encoder.encode("."));
          }, 3000);

          // Call the Groq API
          console.log("Creating chat completion with Groq")
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
            temperature: 0.5,
            max_tokens: 65536,
            top_p: 1,
            stream: true,
          })

          console.log("Receiving response from Groq API")
          controller.enqueue(encoder.encode("Receiving and processing response from AI...\n"))
          controller.enqueue(encoder.encode("Workflow complete. Streaming schema to user...\n"))
          controller.enqueue(encoder.encode("</processing>\n\n"))
          
          console.log("Streaming content from Groq API")
          // Stream the schema content directly without buffering
          let chunkCount = 0;
          for await (const chunk of chatCompletion) {
            if (chunk.choices[0]?.delta?.content) {
              const content = chunk.choices[0].delta.content
              controller.enqueue(encoder.encode(content))
              
              // Send a newline every few chunks to help with streaming recognition
              chunkCount++;
              if (chunkCount % 10 === 0) {
                await new Promise(resolve => setTimeout(resolve, 5));
              }
            }
          }
          
          // Clear the heartbeat interval
          clearInterval(heartbeatInterval);
          
          console.log("Completed streaming schema")
        } catch (error) {
          console.error("Error in Groq API generation:", error)
          controller.enqueue(encoder.encode(`Error generating schema: ${error}\n`))
          
          // Close thinking tag if not already closed
          controller.enqueue(encoder.encode("</think>\n\n"))
          
          // Write error message outside of thinking tags
          controller.enqueue(encoder.encode("An error occurred during schema generation. Please try again."))
          throw error
        }

        controller.close()
      } catch (error) {
        console.error("Error in streamSchemaGeneration:", error)
        
        try {
          // Ensure we always close the controller
          controller.close()
        } catch (closeError) {
          console.error("Error closing controller:", closeError)
        }
      }
    }
  })
}

serve(async (req) => {
  // Set CORS headers for all responses
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  }

  // Handle CORS preflight requests
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
    // Parse the request body
    const { content_plan_outline_guid, live_post_url, task_id, url } = await req.json()
    
    // Handle the different ways to identify content
    const usingOutlineGuid = !!content_plan_outline_guid
    const usingTaskId = !!task_id
    
    console.log("Streaming schema generation request received:", { 
      content_plan_outline_guid, 
      task_id, 
      direct_url: url || live_post_url 
    })

    // Ensure we have some identifier
    if (!content_plan_outline_guid && !task_id && !url && !live_post_url) {
      return new Response(JSON.stringify({ 
        error: "Either content_plan_outline_guid, task_id, or a URL (live_post_url/url) is required" 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Determine the URL to use
    let postUrl = url || live_post_url
    
    // If no direct URL was provided, we'll need to fetch it from the database
    // This will happen in the streamSchemaGeneration function
    
    // Create the streaming response
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