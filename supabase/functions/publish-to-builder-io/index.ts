import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { OpenAI } from 'https://esm.sh/openai@4.20.1'

interface WorkBrightTask {
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
    blocks: Array<{
      "@type": "@builder.io/sdk:Element"
      children?: Array<any>
      component?: {
        name: string
        options: {
          code: string
          scriptsClientOnly: boolean
        }
      }
      responsiveStyles?: {
        large: {
          position: string
        }
      }
    }>
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
  
  // Remove HTML tags and get first paragraph or summary section
  const textContent = htmlContent.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  console.log('Text content length after HTML removal:', textContent.length)
  
  // Look for summary section first
  const summaryMatch = htmlContent.match(/<div[^>]*id="summary"[^>]*>(.*?)<\/div>/s)
  if (summaryMatch) {
    const summaryText = summaryMatch[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
    const result = summaryText.substring(0, 300) + (summaryText.length > 300 ? '...' : '')
    console.log('Found summary div, extracted:', result)
    console.log('=== END SUMMARY EXTRACTION ===')
    return result
  }
  
  // Fallback to first 300 characters
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
async function generateHeroImageForTask(supabase: any, task: WorkBrightTask): Promise<string> {
  console.log('=== GENERATING HERO IMAGE ===')
  console.log('Task ID:', task.task_id)
  console.log('Task Title:', task.title)
  
  // Check if task already has a hero image
  if (task.hero_image_url) {
    console.log('Task already has hero image:', task.hero_image_url)
    console.log('=== END HERO IMAGE GENERATION ===')
    return task.hero_image_url
  }
  
  try {
    // Create OpenAI client
    const openai = new OpenAI({
      apiKey: Deno.env.get("OPENAI_API_KEY") ?? ""
    })
    
    // Generate hero image prompt based on task title and content
    const heroPrompt = `Create a professional, modern hero image for a blog post titled "${task.title}". The image should be suitable for a business/workplace blog about HR, onboarding, and employee management. Use clean, professional design with modern corporate aesthetics. Avoid specific people's faces, focus on workplace concepts, technology, and professional environments. Style: Clean, modern, professional business illustration.`
    
    console.log('Generated hero image prompt:', heroPrompt)
    
    // Add copyright guidance
    const copyrightGuidance = "If this request appears to ask for images of specific copyrighted characters, celebrities, or recognizable likenesses, create an original character inspired by the essence and style rather than reproducing the exact likeness. Create your own original interpretation that captures the spirit without infringing on copyrights or trademarks."
    const enhancedPrompt = `${heroPrompt}\n\n${copyrightGuidance}`
    
    console.log('Calling OpenAI to generate hero image...')
    
    // Generate image using OpenAI GPT Image 1
    const imageResponse = await openai.images.generate({
      model: "gpt-image-1",
      prompt: enhancedPrompt,
      n: 1,
      size: "1024x1024" // GPT Image 1 standard size
    })
    
    console.log('OpenAI GPT Image 1 generation completed')
    
    if (!imageResponse.data || !imageResponse.data[0] || !imageResponse.data[0].b64_json) {
      throw new Error("No image data received from OpenAI GPT Image 1")
    }
    
    const imageBase64 = imageResponse.data[0].b64_json
    console.log('Generated image base64 length:', imageBase64.length)
    
    // Convert base64 to Uint8Array for upload
    const imageBuffer = Uint8Array.from(atob(imageBase64), c => c.charCodeAt(0))
    const fileName = `workbright-hero-${task.task_id}-${Date.now()}.png`
    const bucketName = "hero-images"
    
    console.log('Uploading image to Supabase Storage:', fileName)
    
    // Upload to storage
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
    
    // Get public URL
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
      // Continue anyway, we have the image URL
    }
    
    console.log('=== END HERO IMAGE GENERATION ===')
    return publicUrl
    
  } catch (error) {
    console.error('Error generating hero image:', error)
    console.log('=== HERO IMAGE GENERATION FAILED ===')
    
    // Return default WorkBright image as fallback
    const fallbackUrl = "https://cdn.builder.io/api/v1/image/assets%2F0f81b2eb923e473194607e0dde9e917b%2F097e449093dc408db99cc9383af964d1"
    console.log('Using fallback image:', fallbackUrl)
    return fallbackUrl
  }
}

/**
 * Transform WorkBright task to Builder.io format
 */
function transformToBuilderIo(task: WorkBrightTask, heroImageUrl: string): BuilderIoContent {
  const urlSlug = generateUrlSlug(task.title)
  const blogUrl = `/blog/${urlSlug}`
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
      disableBlogHeroElements: true,
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
 * Post content to Builder.io
 */
async function postToBuilderIo(content: BuilderIoContent, apiKey: string): Promise<any> {
  const payload = JSON.stringify(content, null, 2)
  
  console.log('=== BUILDER.IO API REQUEST ===')
  console.log('URL:', 'https://builder.io/api/v1/write/blog')
  console.log('Method:', 'POST')
  console.log('Headers:', {
    'Authorization': `Bearer ${apiKey.substring(0, 10)}...${apiKey.substring(apiKey.length - 4)}`,
    'Content-Type': 'application/json'
  })
  console.log('Payload Size:', payload.length, 'characters')
  console.log('Payload Preview (first 2000 chars):', payload.substring(0, 2000))
  console.log('Full Payload:', payload)
  console.log('=== END REQUEST DATA ===')

  const response = await fetch('https://builder.io/api/v1/write/blog', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: payload
  })

  console.log('=== BUILDER.IO API RESPONSE ===')
  console.log('Status:', response.status)
  console.log('Status Text:', response.statusText)
  console.log('Response Headers:', Object.fromEntries(response.headers.entries()))

  if (!response.ok) {
    const errorText = await response.text()
    console.log('Error Response Body:', errorText)
    console.log('=== END ERROR RESPONSE ===')
    throw new Error(`Builder.io API error: ${response.status} - ${errorText}`)
  }

  const responseData = await response.json()
  console.log('Success Response Body:', JSON.stringify(responseData, null, 2))
  console.log('=== END SUCCESS RESPONSE ===')

  return responseData
}

/**
 * Update task with published URL
 */
async function updateTaskWithPublishedUrl(
  supabase: any, 
  taskId: string, 
  publishedUrl: string,
  builderResponse: any
): Promise<void> {
  const { error } = await supabase
    .from('tasks')
    .update({ 
      live_post_url: publishedUrl,
      last_published_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('task_id', taskId)

  if (error) {
    console.error('Error updating task with published URL:', error)
    throw error
  }
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { task_id, auto_publish = false } = await req.json()

    if (!task_id) {
      return new Response(
        JSON.stringify({ error: 'task_id is required' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Get task from database
    const { data: task, error: fetchError } = await supabase
      .from('tasks')
      .select('task_id, title, content, client_domain, seo_keyword, status, created_at, live_post_url, hero_image_url, hero_image_prompt')
      .eq('task_id', task_id)
      .eq('client_domain', 'workbright.com')
      .eq('status', 'Complete')
      .single()

    if (fetchError || !task) {
      return new Response(
        JSON.stringify({ error: 'Task not found or not completed for WorkBright' }),
        { 
          status: 404, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Check if already published (unless forcing republish)
    if (task.live_post_url && !auto_publish) {
      return new Response(
        JSON.stringify({ 
          message: 'Task already published',
          task_id: task.task_id,
          published_url: task.live_post_url
        }),
        { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    console.log('=== TASK DATA FROM DATABASE ===')
    console.log('Task ID:', task.task_id)
    console.log('Title:', task.title)
    console.log('Client Domain:', task.client_domain)
    console.log('Status:', task.status)
    console.log('Content Length:', task.content?.length || 0, 'characters')
    console.log('Content Preview (first 500 chars):', task.content?.substring(0, 500) || 'No content')
    console.log('SEO Keyword:', task.seo_keyword)
    console.log('Created At:', task.created_at)
    console.log('Current live_post_url:', task.live_post_url)
    console.log('=== END TASK DATA ===')

    // Generate hero image for the task
    const heroImageUrl = await generateHeroImageForTask(supabase, task)

    // Transform content to Builder.io format
    const builderContent = transformToBuilderIo(task, heroImageUrl)
    
    console.log('=== TRANSFORMATION RESULT ===')
    console.log('Generated URL Slug:', builderContent.data.url)
    console.log('Generated Summary:', builderContent.data.summary)
    console.log('Featured Image (Hero):', builderContent.data.featuredImage)
    console.log('Disable Blog Hero Elements:', builderContent.data.disableBlogHeroElements)
    console.log('Title:', builderContent.name)
    console.log('Published Status:', builderContent.published)
    console.log('Query Value:', builderContent.query[0]?.value)
    console.log('Blocks Count:', builderContent.data.blocks?.length || 0)
    console.log('=== END TRANSFORMATION ===')
    
    console.log('Publishing to Builder.io:', {
      task_id: task.task_id,
      title: task.title,
      url: builderContent.data.url
    })

    // Post to Builder.io
    const builderApiKey = 'bpk-199bc864e2544f5689f1aac14537d6bb'
    const builderResponse = await postToBuilderIo(builderContent, builderApiKey)
    
    // Generate published URL
    const publishedUrl = `https://workbright.com${builderContent.data.url}`
    
    // Generate published URL
    console.log('=== FINALIZING PUBLICATION ===')
    console.log('Builder.io response received successfully')
    console.log('Generated published URL:', publishedUrl)
    
    // Update task with published URL
    await updateTaskWithPublishedUrl(supabase, task.task_id, publishedUrl, builderResponse)
    console.log('Task updated with published URL in database')

    const finalResponse = {
      success: true,
      task_id: task.task_id,
      published_url: publishedUrl,
      builder_response: builderResponse,
      summary: builderContent.data.summary
    }
    
    console.log('=== FINAL RESPONSE ===')
    console.log('Response:', JSON.stringify(finalResponse, null, 2))
    console.log('=== PUBLICATION COMPLETE ===')

    return new Response(
      JSON.stringify(finalResponse),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    console.error('Error publishing to Builder.io:', error)
    
    return new Response(
      JSON.stringify({ 
        error: 'Failed to publish to Builder.io',
        details: error.message
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})