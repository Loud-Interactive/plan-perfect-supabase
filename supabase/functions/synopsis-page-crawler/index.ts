// Supabase Edge Function: synopsis-page-crawler
// Description: Crawls individual pages and converts HTML to markdown

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders } from "../_shared/cors.ts"

// Initialize Supabase client
const supabaseUrl = Deno.env.get('PROJECT_URL') || ''
const supabaseKey = Deno.env.get('SERVICE_ROLE_KEY') || ''
const supabase = createClient(supabaseUrl, supabaseKey)

// ScraperAPI configuration (same as Python version)
const SCRAPER_API_KEY = "6e6fccc00b94c6d57237a9afa3cc64b7"

// Rate limiting for crawler
const RATE_LIMIT_DELAY = 2000 // 2 seconds between requests
let lastRequestTime = 0

interface PageCrawlerRequest {
  task_id: string
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // Store the task_id early to use in error handling
  let taskId: string | null = null

  try {
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed' }),
        { 
          status: 405, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    const requestData: PageCrawlerRequest = await req.json()
    taskId = requestData.task_id

    if (!taskId) {
      return new Response(
        JSON.stringify({ error: 'task_id is required' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    console.log(`Starting page crawling for task ${taskId}`)

    // Get the task details
    const { data: task, error: taskError } = await supabase
      .from('synopsis_page_tasks')
      .select('*')
      .eq('id', taskId)
      .single()

    if (taskError || !task) {
      throw new Error(`Task not found: ${taskId}`)
    }

    // Check if already processing or completed
    if (task.status !== 'pending') {
      console.log(`Task ${taskId} already ${task.status}, skipping`)
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: `Task already ${task.status}`,
          task_id: taskId 
        }),
        { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    // Update task status to processing
    await supabase
      .from('synopsis_page_tasks')
      .update({ 
        status: 'processing',
        updated_at: new Date().toISOString()
      })
      .eq('id', taskId)

    console.log(`Crawling URL: ${task.url}`)

    // Get URL content (same method as Python version)
    const urlContent = await getUrlContent(task.url, false)
    
    if (!urlContent.html && !urlContent.readable_content) {
      throw new Error(`Failed to get content from URL: ${task.url}`)
    }

    // Convert HTML to Markdown
    const markdownContent = await convertHtmlToMarkdown(urlContent.readable_content)

    // Update task with results
    const { error: updateError } = await supabase
      .from('synopsis_page_tasks')
      .update({
        status: 'completed',
        raw_html: urlContent.html,
        markdown_content: markdownContent,
        completed_at: new Date().toISOString(),
        error_message: null
      })
      .eq('id', taskId)

    if (updateError) {
      throw new Error(`Failed to update task: ${updateError.message}`)
    }

    // Update job completed pages count
    await updateJobProgress(task.job_id)

    // Check if all pages are completed and trigger analysis
    await checkAndTriggerAnalysis(task.job_id)

    console.log(`Successfully crawled and processed: ${task.url}`)

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Page crawled successfully',
        task_id: taskId,
        url: task.url,
        content_length: markdownContent.length
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )

  } catch (error) {
    console.error('Error in synopsis-page-crawler:', error)
    
    // Update task status to failed if we have task_id
    if (taskId) {
      const retryCount = await getRetryCount(taskId)
      
      if (retryCount < 3) {
        // Mark for retry
        await supabase
          .from('synopsis_page_tasks')
          .update({
            status: 'pending',
            retry_count: retryCount + 1,
            error_message: `Retry ${retryCount + 1}: ${error.message}`
          })
          .eq('id', taskId)
        
        console.log(`Marked task ${taskId} for retry ${retryCount + 1}`)
      } else {
        // Mark as failed after max retries
        await supabase
          .from('synopsis_page_tasks')
          .update({
            status: 'failed',
            error_message: `Failed after 3 retries: ${error.message}`
          })
          .eq('id', taskId)
        
        console.log(`Task ${taskId} failed after max retries`)
      }
    }
    
    return new Response(
      JSON.stringify({ 
        success: false,
        error: error.message,
        task_id: taskId
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})

/**
 * Get URL content using ScraperAPI (same as Python version)
 */
async function getUrlContent(url: string, needHeader: boolean = false): Promise<{readable_content: string, html: string}> {
  try {
    // Rate limiting - ensure minimum delay between requests
    const now = Date.now()
    const timeSinceLastRequest = now - lastRequestTime
    if (timeSinceLastRequest < RATE_LIMIT_DELAY) {
      const delay = RATE_LIMIT_DELAY - timeSinceLastRequest
      console.log(`Rate limiting: waiting ${delay}ms before next request`)
      await new Promise(resolve => setTimeout(resolve, delay))
    }
    lastRequestTime = Date.now()

    const htmlContent = await fetchWithFallback(url)

    if (!htmlContent) {
      return {
        readable_content: '',
        html: ''
      }
    }

    // Process HTML - remove unnecessary elements (same logic as Python)
    let processedHtml = htmlContent
    
    // Remove script, style, iframe, noscript tags
    processedHtml = processedHtml.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    processedHtml = processedHtml.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    processedHtml = processedHtml.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    processedHtml = processedHtml.replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '')
    
    if (!needHeader) {
      processedHtml = processedHtml.replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, '')
      processedHtml = processedHtml.replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, '')
      processedHtml = processedHtml.replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, '')
    }

    // Remove attributes except href and src (same as Python)
    processedHtml = processedHtml.replace(/<(\w+)([^>]*?)>/gi, (match, tag, attrs) => {
      const cleanAttrs = attrs.replace(/\s(\w+)=["'][^"']*["']/gi, (attrMatch: string, attrName: string) => {
        if (attrName.toLowerCase() === 'href' || attrName.toLowerCase() === 'src') {
          return attrMatch
        }
        return ''
      })
      return `<${tag}${cleanAttrs}>`
    })

    // Extract text content with line breaks
    const textContent = processedHtml
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<\/h[1-6]>/gi, '\n\n')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/\n\s+/g, '\n')
      .trim()

    return {
      readable_content: textContent,
      html: processedHtml
    }
    
  } catch (error) {
    console.error('Error fetching URL content:', error)
    return {
      readable_content: "",
      html: ""
    }
  }
}

async function fetchWithFallback(url: string): Promise<string | null> {
  try {
    const scraperUrl = new URL('http://api.scraperapi.com')
    scraperUrl.searchParams.set('api_key', SCRAPER_API_KEY)
    scraperUrl.searchParams.set('premium', 'true')
    scraperUrl.searchParams.set('retry_404', 'true')
    scraperUrl.searchParams.set('country_code', 'us')
    scraperUrl.searchParams.set('device_type', 'desktop')
    scraperUrl.searchParams.set('url', url)
    scraperUrl.searchParams.set('ultra_premium', 'false')
    scraperUrl.searchParams.set('render', 'true')

    const response = await fetch(scraperUrl.toString(), {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 600000
    })

    if (response.ok) {
      const html = await response.text()
      if (html && html.trim().length > 0) {
        return html
      }
      console.warn(`[synopsis-page-crawler] Empty response from ScraperAPI for ${url}`)
    } else if (response.status === 429) {
      console.log('Got 429 Too Many Requests from ScraperAPI, will be retried later')
      return null
    } else {
      console.warn(`[synopsis-page-crawler] ScraperAPI error ${response.status} for ${url}`)
    }
  } catch (error) {
    console.error('[synopsis-page-crawler] ScraperAPI request failed:', error)
  }

  try {
    console.log(`[synopsis-page-crawler] Falling back to direct fetch for ${url}`)
    const directResponse = await fetch(url, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    })

    if (directResponse.ok) {
      const directHtml = await directResponse.text()
      if (directHtml && directHtml.trim().length > 0) {
        return directHtml
      }
      console.warn(`[synopsis-page-crawler] Direct fetch returned empty body for ${url}`)
    } else {
      console.warn(`[synopsis-page-crawler] Direct fetch error ${directResponse.status} for ${url}`)
    }
  } catch (error) {
    console.error('[synopsis-page-crawler] Direct fetch failed:', error)
  }

  try {
    console.log(`[synopsis-page-crawler] Falling back to Jina proxy for ${url}`)
    const proxiedUrl = `https://r.jina.ai/${url.startsWith('http') ? url : `https://${url}`}`
    const proxyResponse = await fetch(proxiedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    })

    if (proxyResponse.ok) {
      const proxyHtml = await proxyResponse.text()
      if (proxyHtml && proxyHtml.trim().length > 0) {
        return proxyHtml
      }
      console.warn(`[synopsis-page-crawler] Jina proxy returned empty body for ${url}`)
    } else {
      console.warn(`[synopsis-page-crawler] Jina proxy error ${proxyResponse.status} for ${url}`)
    }
  } catch (error) {
    console.error('[synopsis-page-crawler] Jina proxy fetch failed:', error)
  }

  return null
}

/**
 * Convert HTML to Markdown (basic conversion)
 */
async function convertHtmlToMarkdown(content: string): Promise<string> {
  // Basic HTML to Markdown conversion
  // This preserves the main content structure without CSS/JS
  
  let markdown = content
  
  // Convert common HTML elements to Markdown
  markdown = markdown
    .replace(/\n{3,}/g, '\n\n') // Reduce multiple newlines
    .replace(/\s{2,}/g, ' ') // Reduce multiple spaces
    .trim()
  
  return markdown
}

/**
 * Get retry count for a task
 */
async function getRetryCount(taskId: string): Promise<number> {
  try {
    const { data: task, error } = await supabase
      .from('synopsis_page_tasks')
      .select('retry_count')
      .eq('id', taskId)
      .single()
    
    if (error || !task) {
      return 0
    }
    
    return task.retry_count || 0
  } catch (error) {
    console.error('Error getting retry count:', error)
    return 0
  }
}

/**
 * Update job progress (increment completed pages)
 */
async function updateJobProgress(jobId: string): Promise<void> {
  try {
    // Get current completed count
    const { data: job, error: jobError } = await supabase
      .from('synopsis_jobs')
      .select('completed_pages')
      .eq('id', jobId)
      .single()

    if (jobError || !job) {
      throw new Error(`Job not found: ${jobId}`)
    }

    // Increment completed pages
    await supabase
      .from('synopsis_jobs')
      .update({ 
        completed_pages: (job.completed_pages || 0) + 1,
        updated_at: new Date().toISOString()
      })
      .eq('id', jobId)

    console.log(`Updated job ${jobId} progress: ${(job.completed_pages || 0) + 1} pages completed`)
  } catch (error) {
    console.error('Error updating job progress:', error)
    // Don't throw - this is not critical for task completion
  }
}

/**
 * Check if all pages are completed and trigger analysis
 */
async function checkAndTriggerAnalysis(jobId: string): Promise<void> {
  try {
    // Get job details
    const { data: job, error: jobError } = await supabase
      .from('synopsis_jobs')
      .select('total_pages, completed_pages')
      .eq('id', jobId)
      .single()

    if (jobError || !job) {
      throw new Error(`Job not found: ${jobId}`)
    }

    // Check if all pages are completed
    if (job.completed_pages >= job.total_pages) {
      console.log(`All pages completed for job ${jobId}, triggering analysis`)
      
      // Trigger the analyzer
      await fetch(`${supabaseUrl}/functions/v1/synopsis-analyzer`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          job_id: jobId
        })
      })
    }
  } catch (error) {
    console.error('Error checking/triggering analysis:', error)
    // Don't throw - this is not critical for task completion
  }
}
