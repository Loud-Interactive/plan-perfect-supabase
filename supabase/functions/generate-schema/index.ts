// supabase/functions/generate-schema/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { Groq } from 'npm:groq-sdk'
import { notifySchemaGenerated } from '../_shared/webhook-integration.ts'

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

  // Parse the request body
  const { content_plan_outline_guid, live_post_url, task_id } = await req.json()
  
  // Determine which ID to use - either outline GUID or task ID
  const usingOutlineGuid = !!content_plan_outline_guid
  const identifier = content_plan_outline_guid || task_id
  
  console.log(`Processing schema generation for ${usingOutlineGuid ? 'outline' : 'task'} ${identifier}`)
  
  if (!content_plan_outline_guid && !task_id) {
    return new Response(
      JSON.stringify({ error: "Either content_plan_outline_guid or task_id is required" }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
  
  try {
    // Initialize Supabase client with service role key for admin rights
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    )
    
    // Get the post URL based on which ID we're using
    let postUrl = live_post_url;
    
    if (!postUrl) {
      console.log("No URL provided, fetching from database...")
      
      if (usingOutlineGuid) {
        // First try to fetch from content_plan_outlines table
        const { data: outlineData, error: outlineError } = await supabaseClient
          .from('content_plan_outlines')
          .select('live_post_url')
          .eq('guid', content_plan_outline_guid)
          .single();
        
        if (!outlineError && outlineData && outlineData.live_post_url) {
          postUrl = outlineData.live_post_url;
          console.log(`Found URL from outline: ${postUrl}`);
        } else {
          // If not found or error, try to fetch from tasks table using content_plan_outline_guid
          console.log(`No URL found in outlines table, checking tasks table...`);
          const { data: tasksData, error: tasksError } = await supabaseClient
            .from('tasks')
            .select('live_post_url')
            .eq('content_plan_outline_guid', content_plan_outline_guid)
            .order('created_at', { ascending: false })
            .limit(1);
          
          if (tasksError) {
            throw new Error(`Failed to fetch tasks data: ${tasksError.message}`);
          }
          
          if (!tasksData || tasksData.length === 0 || !tasksData[0].live_post_url) {
            throw new Error(`No live_post_url found for outline ${content_plan_outline_guid} in tasks table`);
          }
          
          postUrl = tasksData[0].live_post_url;
          console.log(`Found URL from tasks table: ${postUrl}`);
        }
      } else {
        // Fetch URL from tasks table
        const { data: taskData, error: taskError } = await supabaseClient
          .from('tasks')
          .select('live_post_url')
          .eq('task_id', task_id)
          .single();
        
        if (taskError) {
          throw new Error(`Failed to fetch task data: ${taskError.message}`);
        }
        
        if (!taskData || !taskData.live_post_url) {
          throw new Error(`No live_post_url found for task ${task_id}`);
        }
        
        postUrl = taskData.live_post_url;
        console.log(`Found URL from task: ${postUrl}`);
      }
    }
    
    if (!postUrl) {
      return new Response(
        JSON.stringify({ error: "No live_post_url provided or found in the database" }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Step 1: Convert URL to Markdown using dedicated Edge Function
    console.log(`Converting URL to Markdown using dedicated function: ${postUrl}`)
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
    
    const markdownResponse = await fetch(`${supabaseUrl}/functions/v1/fetch-markdown-content`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseAnonKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ url: postUrl })
    });
    
    if (!markdownResponse.ok) {
      const errorData = await markdownResponse.json();
      throw new Error(`Failed to convert URL to markdown: ${errorData.error || markdownResponse.statusText}`);
    }
    
    const markdownData = await markdownResponse.json();
    const markdown = markdownData.markdown;
    console.log(`Successfully converted URL to Markdown (${markdown.length} characters)`)
    
    // Step 2: Extract domain data using dedicated Edge Function
    console.log(`Fetching domain preferences using dedicated function`)
    
    const preferencesResponse = await fetch(`${supabaseUrl}/functions/v1/fetch-domain-preferences`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseAnonKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ url: postUrl })
    });
    
    if (!preferencesResponse.ok) {
      const errorData = await preferencesResponse.json();
      throw new Error(`Failed to fetch domain preferences: ${errorData.error || preferencesResponse.statusText}`);
    }
    
    const domainData = await preferencesResponse.json();
    console.log(`Successfully retrieved domain data for ${domainData.domain}`);
    
    // Extract useful information
    const synopsis = domainData.synopsis || "";
    const jsonLdSchemaPostTemplate = domainData.jsonLdSchemaPostTemplate || "";
    const jsonLdSchemaGenerationPrompt = domainData.jsonLdSchemaGenerationPrompt || "";
    
    // Step 3: Generate schema with Groq API
    console.log("Generating schema with AI...")
    
    // Initialize Groq client
    const groq = new Groq({
      apiKey: Deno.env.get('GROQ_API_KEY'),
    })
    
    // Get current date and time
    const currentDate = new Date();
    const formattedDate = currentDate.toISOString();
    
    // Construct the prompt
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
    
    
   IMPORTANT: Return ONLY the raw JSON-LD schema. Do not wrap it in code blocks with backticks, and do not surround it with any tags. Just return the pure, valid JSON object. `
    
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
      temperature: 0.6, // Recommended temperature for reasoning models
      max_completion_tokens: 65536, // Use max_completion_tokens instead of max_tokens
      top_p: 0.95, // Recommended top_p for reasoning models
      reasoning_effort: "high", // High reasoning effort for complex schema generation
      include_reasoning: true // Include reasoning for better debugging
    })
    
    const llmContent = chatCompletion.choices[0]?.message?.content || ""
    const reasoning = chatCompletion.choices[0]?.message?.reasoning || ""
    
    console.log(`Generated schema with reasoning (${reasoning.length} chars of reasoning)`)
    if (reasoning) {
      console.log(`Reasoning preview: ${reasoning.substring(0, 200)}...`)
    }
    
    // Extract schema from content - handling multiple possible formats
    let schemaContent = ""
    
    // First, remove any <think> tags and content between them
    const withoutThinkingTags = llmContent.replace(/<think>[\s\S]*?<\/think>/g, "").trim()
    
    // Now try to extract from <schema> tags
    const schemaTagMatch = withoutThinkingTags.match(/<schema>([\s\S]*?)<\/schema>/i)
    if (schemaTagMatch && schemaTagMatch[1]) {
      schemaContent = schemaTagMatch[1].trim()
    } 
    // Then, try to extract from ```json code blocks
    else {
      const jsonCodeBlockMatch = withoutThinkingTags.match(/```json\s*([\s\S]*?)```/i)
      if (jsonCodeBlockMatch && jsonCodeBlockMatch[1]) {
        schemaContent = jsonCodeBlockMatch[1].trim()
      }
      // If no code block with json explicitly specified, try any code block
      else {
        const codeBlockMatch = withoutThinkingTags.match(/```\s*([\s\S]*?)```/i)
        if (codeBlockMatch && codeBlockMatch[1]) {
          schemaContent = codeBlockMatch[1].trim()
        }
        // Try to find a standalone JSON object
        else {
          const jsonObjectMatch = withoutThinkingTags.match(/(\{[\s\S]*\})/g)
          if (jsonObjectMatch && jsonObjectMatch.length > 0) {
            // Use the first match as it's most likely to be the complete schema
            schemaContent = jsonObjectMatch[0].trim()
          }
          // If nothing else works, just use the raw content without thinking tags
          else {
            schemaContent = withoutThinkingTags.trim()
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
      const jsonObj = JSON.parse(schemaContent)
      schemaContent = JSON.stringify(jsonObj)
      console.log(`Successfully parsed and validated JSON schema`)
    } catch (jsonError) {
      console.warn(`Warning: Could not validate schema as JSON: ${jsonError.message}`)
      // Try fixing JSON by removing everything after the last valid closing brace
      try {
        const lastBrace = schemaContent.lastIndexOf('}')
        if (lastBrace > 0) {
          const truncatedContent = schemaContent.substring(0, lastBrace + 1)
          const jsonObj = JSON.parse(truncatedContent)
          schemaContent = JSON.stringify(jsonObj)
          console.log(`Fixed JSON by truncating after last closing brace`)
        }
      } catch (fixError) {
        console.warn(`Could not fix JSON: ${fixError.message}`)
        // Keep the extracted content as is
      }
    }
    
    console.log(`Generated schema, length: ${schemaContent.length}`)

    // Step 4: Update the record with the generated schema
    console.log(`Updating ${usingOutlineGuid ? 'outline' : 'task'} record with generated schema...`)
    
    let error;
    
    if (usingOutlineGuid) {
      // Update content_plan_outlines table
      const { error: outlineError } = await supabaseClient
        .from('tasks')
        .update({ schema_data: schemaContent })
        .eq('content_plan_outline_guid', content_plan_outline_guid)
      
      error = outlineError;
      
      if (!error) {
        console.log(`Successfully updated schema_data for outline ${content_plan_outline_guid}`)
      }
    } else {
      // Update tasks table (for backward compatibility)
      const { error: taskError } = await supabaseClient
        .from('tasks')
        .update({ schema_data: schemaContent })
        .eq('task_id', task_id)
      
      error = taskError;
      
      if (!error) {
        console.log(`Successfully updated schema_data for task ${task_id}`)
      }
    }
    
    if (error) {
      throw error
    }
    
    // Send webhook notification if task_id is provided
    if (task_id) {
      try {
        console.log('[Webhook] Sending schema_generated webhook for task:', task_id);
        await notifySchemaGenerated(
          supabaseClient,
          task_id,
          {
            schema: schemaContent,
            schema_type: 'Article', // Default type for this function
            validation_status: 'valid',
            url: postUrl,
            reasoning: reasoning
          }
        );
        console.log('[Webhook] ✅ schema_generated webhook sent successfully');
      } catch (webhookError) {
        console.error('[Webhook] Failed to send schema_generated webhook:', webhookError);
        // Don't fail the function if webhook fails
      }
    } else {
      console.log('[Webhook] Skipping schema_generated webhook (no task_id provided)');
    }
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Schema generated and saved successfully",
        schemaLength: schemaContent.length,
        reasoning: reasoning,
        reasoningLength: reasoning.length
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error("Error in schema generation process:", error)
    
    return new Response(
      JSON.stringify({ error: `Schema generation failed: ${error.message}` }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})