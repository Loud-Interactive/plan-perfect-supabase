import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { OpenAI } from 'https://esm.sh/openai@4.20.1'

interface Task {
  task_id: string
  title: string
  content: string
  client_domain: string
  seo_keyword: string
  status: string
  created_at: string
  live_post_url?: string
  hero_image_url?: string
  hero_image_prompt?: string
  content_plan_outline_guid?: string
}

interface ClientBuilderConfig {
  id: string
  client_domain: string
  builder_api_key: string
  builder_model: string
  builder_endpoint: string
  featured_image_required: boolean
  disable_hero_elements: boolean
  url_prefix: string
  default_hero_prompt: string
  active: boolean
}

interface BuilderIoContent {
  name: string
  published: string
  query: Array<{
    "@type": "@builder.io/core:Query"
    property: string
    operator: string
    value: string
  }>
  data: {
    title: string
    summary: string
    publishedDate: string
    featuredImage?: string
    disableBlogHeroElements: boolean
    url: string
    blocks: Array<any>
    state: {
      deviceSize: string
      location: {
        path: string
        query: object
      }
    }
  }
}

/**
 * Extract summary from HTML content
 */
function extractSummary(htmlContent: string): string {
  console.log('=== EXTRACTING SUMMARY ===')
  console.log('Input content length:', htmlContent?.length || 0)
  
  const textContent = htmlContent.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  console.log('Text content length after HTML removal:', textContent.length)
  
  const summaryMatch = htmlContent.match(/<div[^>]*id="summary"[^>]*>(.*?)<\/div>/s)
  if (summaryMatch) {
    const summaryText = summaryMatch[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
    const result = summaryText.substring(0, 300) + (summaryText.length > 300 ? '...' : '')
    console.log('Found summary div, extracted:', result)
    console.log('=== END SUMMARY EXTRACTION ===')
    return result
  }
  
  const result = textContent.substring(0, 300) + (textContent.length > 300 ? '...' : '')
  console.log('Using fallback summary:', result)
  console.log('=== END SUMMARY EXTRACTION ===')
  return result
}

/**
 * Generate URL slug from title
 */
function generateUrlSlug(title: string): string {
  console.log('=== GENERATING URL SLUG ===')
  console.log('Input title:', title)
  
  const result = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    
  console.log('Generated slug:', result)
  console.log('=== END URL SLUG GENERATION ===')
  return result
}

/**
 * Generate hero image for task using OpenAI
 */
async function generateHeroImageForTask(supabase: any, task: Task, config: ClientBuilderConfig): Promise<string> {
  console.log('=== GENERATING HERO IMAGE ===')
  console.log('Task ID:', task.task_id)
  console.log('Client Domain:', task.client_domain)
  
  // Check if task already has a hero image
  if (task.hero_image_url) {
    console.log('Task already has hero image:', task.hero_image_url)
    console.log('=== END HERO IMAGE GENERATION ===')
    return task.hero_image_url
  }
  
  // Check if hero image is required for this client
  if (!config.featured_image_required) {
    console.log('Hero image not required for this client, using default')
    console.log('=== END HERO IMAGE GENERATION ===')
    return "https://cdn.builder.io/api/v1/image/assets%2F0f81b2eb923e473194607e0dde9e917b%2F097e449093dc408db99cc9383af964d1"
  }
  
  try {
    const openai = new OpenAI({
      apiKey: Deno.env.get("OPENAI_API_KEY") ?? ""
    })
    
    // Use custom hero prompt for this client or generate one
    const heroPrompt = config.default_hero_prompt 
      ? `${config.default_hero_prompt} Article title: "${task.title}"`
      : `Create a professional, modern hero image for a blog post titled "${task.title}". The image should be suitable for ${task.client_domain} website. Use clean, professional design with modern aesthetics. Style: Clean, modern, professional business illustration.`
    
    console.log('Generated hero image prompt:', heroPrompt)
    
    const copyrightGuidance = "If this request appears to ask for images of specific copyrighted characters, celebrities, or recognizable likenesses, create an original character inspired by the essence and style rather than reproducing the exact likeness."
    const enhancedPrompt = `${heroPrompt}\n\n${copyrightGuidance}`
    
    console.log('Calling OpenAI GPT Image 1...')
    
    const imageResponse = await openai.images.generate({
      model: "gpt-image-1",
      prompt: enhancedPrompt,
      n: 1,
      size: "1024x1024"
    })
    
    console.log('OpenAI GPT Image 1 generation completed')
    
    if (!imageResponse.data || !imageResponse.data[0] || !imageResponse.data[0].b64_json) {
      throw new Error("No image data received from OpenAI GPT Image 1")
    }
    
    const imageBase64 = imageResponse.data[0].b64_json
    console.log('Generated image base64 length:', imageBase64.length)
    
    const imageBuffer = Uint8Array.from(atob(imageBase64), c => c.charCodeAt(0))
    const fileName = `${task.client_domain}-hero-${task.task_id}-${Date.now()}.png`
    const bucketName = "hero-images"
    
    console.log('Uploading image to Supabase Storage:', fileName)
    
    const { data: uploadData, error: uploadError } = await supabase
      .storage
      .from(bucketName)
      .upload(fileName, imageBuffer, {
        contentType: "image/png",
        upsert: true
      })
    
    if (uploadError) {
      throw new Error(`Error uploading image: ${uploadError.message}`)
    }
    
    const { data: publicUrlData } = supabase
      .storage
      .from(bucketName)
      .getPublicUrl(fileName)
    
    const publicUrl = publicUrlData.publicUrl
    console.log('Hero image uploaded successfully:', publicUrl)
    
    // Update task with hero image URL
    const { error: updateError } = await supabase
      .from('tasks')
      .update({
        hero_image_url: publicUrl,
        hero_image_prompt: heroPrompt,
        updated_at: new Date().toISOString()
      })
      .eq('task_id', task.task_id)
    
    if (updateError) {
      console.error('Error updating task with hero image:', updateError)
    }
    
    console.log('=== END HERO IMAGE GENERATION ===')
    return publicUrl
    
  } catch (error) {
    console.error('Error generating hero image:', error)
    console.log('=== HERO IMAGE GENERATION FAILED ===')
    
    const fallbackUrl = "https://cdn.builder.io/api/v1/image/assets%2F0f81b2eb923e473194607e0dde9e917b%2F097e449093dc408db99cc9383af964d1"
    console.log('Using fallback image:', fallbackUrl)
    return fallbackUrl
  }
}

/**
 * Transform task to Builder.io format using client config
 */
function transformToBuilderIo(task: Task, config: ClientBuilderConfig, heroImageUrl: string): BuilderIoContent {
  const urlSlug = generateUrlSlug(task.title)
  const blogUrl = `${config.url_prefix}/${urlSlug}`
  const summary = extractSummary(task.content)
  
  return {
    name: task.title,
    published: "draft",
    query: [
      {
        "@type": "@builder.io/core:Query",
        property: "urlPath",
        operator: "is",
        value: blogUrl
      }
    ],
    data: {
      title: task.title,
      summary: summary,
      publishedDate: new Date().toISOString(),
      featuredImage: heroImageUrl,
      disableBlogHeroElements: config.disable_hero_elements,
      url: blogUrl,
      blocks: [
        {
          "@type": "@builder.io/sdk:Element",
          children: [
            {
              "@type": "@builder.io/sdk:Element",
              component: {
                name: "Custom Code",
                options: {
                  code: task.content,
                  scriptsClientOnly: true
                }
              },
              responsiveStyles: {
                large: {
                  position: "relative"
                }
              }
            }
          ]
        },
        {
          "@type": "@builder.io/sdk:Element",
          tagName: "img",
          properties: {
            src: "https://cdn.builder.io/api/v1/pixel?apiKey=0f81b2eb923e473194607e0dde9e917b",
            "aria-hidden": "true",
            alt: "",
            role: "presentation",
            width: "0",
            height: "0"
          },
          responsiveStyles: {
            large: {
              height: "0",
              width: "0",
              display: "inline-block",
              opacity: "0",
              overflow: "hidden",
              pointerEvents: "none"
            }
          }
        }
      ],
      state: {
        deviceSize: "large",
        location: {
          path: "",
          query: {}
        }
      }
    }
  }
}

/**
 * Post content to client's Builder.io
 */
async function postToClientBuilderIo(content: BuilderIoContent, config: ClientBuilderConfig): Promise<any> {
  const payload = JSON.stringify(content, null, 2)
  
  console.log('=== CLIENT BUILDER.IO API REQUEST ===')
  console.log('Client Domain:', config.client_domain)
  console.log('Builder Model:', config.builder_model)
  console.log('URL:', `https://builder.io${config.builder_endpoint}`)
  console.log('Method:', 'POST')
  console.log('Headers:', {
    'Authorization': `Bearer ${config.builder_api_key.substring(0, 10)}...${config.builder_api_key.substring(config.builder_api_key.length - 4)}`,
    'Content-Type': 'application/json'
  })
  console.log('Payload Size:', payload.length, 'characters')
  console.log('Full Payload:', payload)
  console.log('=== END REQUEST DATA ===')

  const response = await fetch(`https://builder.io${config.builder_endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.builder_api_key}`,
      'Content-Type': 'application/json',
    },
    body: payload
  })

  console.log('=== CLIENT BUILDER.IO API RESPONSE ===')
  console.log('Status:', response.status)
  console.log('Status Text:', response.statusText)
  console.log('Response Headers:', Object.fromEntries(response.headers.entries()))

  if (!response.ok) {
    const errorText = await response.text()
    console.log('Error Response Body:', errorText)
    console.log('=== END ERROR RESPONSE ===')
    throw new Error(`Builder.io API error for ${config.client_domain}: ${response.status} - ${errorText}`)
  }

  const responseData = await response.json()
  console.log('Success Response Body:', JSON.stringify(responseData, null, 2))
  console.log('=== END SUCCESS RESPONSE ===')

  return responseData
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { task_id, content_plan_outline_guid, client_domain, auto_publish = false } = await req.json()

    // Get task either by task_id or content_plan_outline_guid
    let task: Task
    if (task_id) {
      const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .eq('task_id', task_id)
        .eq('status', 'Complete')
        .single()
      
      if (error || !data) {
        return new Response(
          JSON.stringify({ error: 'Task not found or not completed' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      task = data
    } else if (content_plan_outline_guid) {
      const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .eq('content_plan_outline_guid', content_plan_outline_guid)
        .eq('status', 'Complete')
        .order('created_at', { ascending: false })
        .limit(1)
        .single()
      
      if (error || !data) {
        return new Response(
          JSON.stringify({ error: 'No completed task found for this content plan outline GUID' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      task = data
    } else {
      return new Response(
        JSON.stringify({ error: 'Either task_id or content_plan_outline_guid is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Use provided client_domain or task's client_domain
    const targetDomain = client_domain || task.client_domain
    
    console.log(`=== PUBLISHING TO CLIENT BUILDER.IO ===`)
    console.log('Task ID:', task.task_id)
    console.log('Target Client Domain:', targetDomain)
    console.log('Task Title:', task.title)

    // Get client's Builder.io configuration
    const { data: config, error: configError } = await supabase
      .from('client_builder_configs')
      .select('*')
      .eq('client_domain', targetDomain)
      .eq('active', true)
      .single()

    if (configError || !config) {
      return new Response(
        JSON.stringify({ 
          error: `No active Builder.io configuration found for domain: ${targetDomain}`,
          details: configError?.message || 'Configuration not found'
        }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('Found Builder.io config for:', config.client_domain)
    console.log('Builder Model:', config.builder_model)
    console.log('URL Prefix:', config.url_prefix)

    // Check if already published (unless forcing republish)
    if (task.live_post_url && !auto_publish) {
      return new Response(
        JSON.stringify({ 
          message: 'Task already published',
          task_id: task.task_id,
          published_url: task.live_post_url,
          client_domain: targetDomain
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Generate hero image for the task
    const heroImageUrl = await generateHeroImageForTask(supabase, task, config)

    // Transform content to Builder.io format
    const builderContent = transformToBuilderIo(task, config, heroImageUrl)
    
    console.log('=== TRANSFORMATION RESULT ===')
    console.log('Generated URL Slug:', builderContent.data.url)
    console.log('Generated Summary:', builderContent.data.summary)
    console.log('Featured Image (Hero):', builderContent.data.featuredImage)
    console.log('Disable Blog Hero Elements:', builderContent.data.disableBlogHeroElements)
    console.log('=== END TRANSFORMATION ===')

    // Post to client's Builder.io
    const builderResponse = await postToClientBuilderIo(builderContent, config)
    
    // Generate published URL
    const publishedUrl = `https://${targetDomain}${builderContent.data.url}`
    
    // Update task with published URL
    await supabase
      .from('tasks')
      .update({ 
        live_post_url: publishedUrl,
        last_published_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('task_id', task.task_id)

    console.log(`=== PUBLICATION COMPLETE ===`)
    console.log('Published to:', publishedUrl)

    return new Response(
      JSON.stringify({
        success: true,
        task_id: task.task_id,
        client_domain: targetDomain,
        published_url: publishedUrl,
        builder_response: builderResponse,
        summary: builderContent.data.summary,
        builder_config: {
          model: config.builder_model,
          endpoint: config.builder_endpoint,
          url_prefix: config.url_prefix
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error in publish-to-client-builder:', error)
    
    return new Response(
      JSON.stringify({ 
        error: 'Failed to publish to client Builder.io',
        details: error.message
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})