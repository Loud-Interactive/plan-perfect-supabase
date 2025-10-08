// Supabase Edge Function: synopsis-page-discovery
// Description: Discovers important pages from main domain and queues them for crawling

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders } from "../_shared/cors.ts"

// Initialize Supabase client
const supabaseUrl = Deno.env.get('PROJECT_URL') || ''
const supabaseKey = Deno.env.get('SERVICE_ROLE_KEY') || ''
const supabase = createClient(supabaseUrl, supabaseKey)

// ScraperAPI configuration
const SCRAPER_API_KEY = "6e6fccc00b94c6d57237a9afa3cc64b7" // From Python version
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') || ''

interface PageDiscoveryRequest {
  job_id: string
  domain_url: string
}

interface ImportantPage {
  title: string
  url: string
  category: string
  importance: number
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // Store job_id for error handling
  let currentJobId: string | undefined

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

    const { job_id, domain_url }: PageDiscoveryRequest = await req.json()

    if (!job_id || !domain_url) {
      return new Response(
        JSON.stringify({ error: 'job_id and domain_url are required' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    console.log(`Starting page discovery for job ${job_id}, domain: ${domain_url}`)
    
    // Store job_id for error handling
    currentJobId = job_id

    // Update job status
    await supabase
      .from('synopsis_jobs')
      .update({ status: 'processing' })
      .eq('id', job_id)

    // Get HTML content of main domain (with headers)
    console.log('Fetching main domain HTML content...')
    const domainContent = await getUrlContent(domain_url, true)
    
    if (!domainContent.html) {
      throw new Error('Failed to get HTML content from main domain')
    }

    // Use LLM to identify important pages - EXACT PROMPT FROM PYTHON VERSION
    const importantPagesPrompt = `based on the html code of the home page of ${domain_url} please tell me the most important links classifying them about the company, company culture, DEI, inclusiveness, rewards & loyalty, top products, top services, do not include terms and services, privacy policies. rank these with a scoring system 1-10 based on how important it is to understand the company.It should be formatted like this:
    [
        {
            "title": "Our Company",
            "url": "https://domain.com/pages/our-company",
            "category": "about the company",
            "importance": 9
        },
        {
            "title": "Careers",
            "url": "https://domain.com/pages/careers",
            "category": "company culture",
            "importance": 8
        },
        {
            "title": "Diversity, Equity & Inclusion",
            "url": "https://domain.com/pages/diversity-equity-inclusion",
            "category": "DEI & inclusiveness",
            "importance": 10
        },
        {
            "title": "BlueRewards",
            "url": "https://domain.com/pages/bluerewards",
            "category": "rewards & loyalty",
            "importance": 7
        },
        {
            "title": "Bestsellers",
            "url": "https://domain.com/collections/best-sellers",
            "category": "top products",
            "importance": 6
        },
        {
            "title": "Spa Menu",
            "url": "https://domain.com/pages/spa-menu",
            "category": "top services",
            "importance": 5
        },
        {
            "title": "In-Store Events",
            "url": "https://domain.com/pages/in-store-events",
            "category": "company culture",
            "importance": 4
        },
        {
            "title": "Gifts with Purchase",
            "url": "https://domain.com/pages/gifts-with-purchase",
            "category": "rewards & loyalty",
            "importance": 3
        },
        {
            "title": "Affiliate Program",
            "url": "https://domain.com/pages/bluemercury-affiliate-program",
            "category": "about the company",
            "importance": 2
        },
        {
            "title": "Contact Us",
            "url": "https://domain.com/pages/contact-us",
            "category": "customer service",
            "importance": 1
        }
    ]
    ONLY RETURN THE JSON. NO COMMENTS ONLY VALID JSON. Here is the html code:
    ${domainContent.html}`

    console.log('Analyzing HTML to identify important pages...')
    const importantPagesResponse = await askGPT4(importantPagesPrompt)
    
    // Parse the response to extract important pages
    const importantPages = parseImportantPagesResponse(importantPagesResponse)
    console.log(`Identified ${importantPages.length} important pages`)

    const criticalSet = new Set<string>()
    if (importantPages.length > 0) {
      const sortedForCritical = [...importantPages].sort((a, b) => b.importance - a.importance)
      const criticalCount = Math.min(5, sortedForCritical.length)
      for (let i = 0; i < criticalCount; i++) {
        criticalSet.add(sortedForCritical[i].url)
      }
    }

    // Create page crawl tasks for each important page
    const pageTasks = []
    for (const page of importantPages) {
      // Normalize URL (same logic as Python version)
      let normalizedUrl = page.url
      if (!normalizedUrl.startsWith('https://') && !normalizedUrl.startsWith('http://')) {
        const parsedDomain = new URL(domain_url)
        normalizedUrl = `${parsedDomain.protocol}//${parsedDomain.hostname}${normalizedUrl}`
      }

      // Fix URL formatting issues (from Python version)
      normalizedUrl = normalizedUrl
        .replace(/\/\//g, '/')
        .replace(/http:\/([^/])/, 'http://$1')
        .replace(/https:\/([^/])/, 'https://$1')
        .replace(/\/\/\//g, '//')

      pageTasks.push({
        job_id: job_id,
        url: normalizedUrl,
        title: page.title,
        category: page.category,
        importance: page.importance,
        is_critical: criticalSet.has(page.url) || criticalSet.has(normalizedUrl),
        status: 'pending'
      })
    }

    // Insert page tasks into database
    if (pageTasks.length > 0) {
      const { error: tasksError } = await supabase
        .from('synopsis_page_tasks')
        .insert(pageTasks)

      if (tasksError) {
        throw new Error(`Failed to create page tasks: ${tasksError.message}`)
      }
    }

    // Update job with total pages count
    await supabase
      .from('synopsis_jobs')
      .update({ 
        total_pages: pageTasks.length,
        status: 'processing'
      })
      .eq('id', job_id)

    console.log(`Created ${pageTasks.length} page crawl tasks`)

    // Trigger page crawling for all tasks
    await triggerPageCrawling(job_id)

    return new Response(
      JSON.stringify({
        success: true,
        message: `Discovered ${pageTasks.length} important pages`,
        pages_discovered: pageTasks.length,
        job_id: job_id
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )

  } catch (error) {
    console.error('Error in synopsis-page-discovery:', error)
    
    // Update job status to failed if we have job_id
    if (currentJobId) {
      await supabase
        .from('synopsis_jobs')
        .update({
          status: 'failed',
          error_message: `Page discovery failed: ${error.message}`
        })
        .eq('id', currentJobId)
    }
    
    return new Response(
      JSON.stringify({ 
        success: false,
        error: error.message 
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
    const htmlContent = await fetchWithFallback(url)

    if (!htmlContent) {
      throw new Error('Unable to retrieve HTML content via ScraperAPI or direct fetch')
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

    // Extract text content
    const textContent = processedHtml
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
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

    const scraperResponse = await fetch(scraperUrl.toString(), {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 600000
    })

    if (scraperResponse.ok) {
      const html = await scraperResponse.text()
      if (html && html.trim().length > 0) {
        return html
      }
      console.warn(`[synopsis-page-discovery] Empty response from ScraperAPI for ${url}`)
    } else {
      console.warn(`[synopsis-page-discovery] ScraperAPI error ${scraperResponse.status} for ${url}`)
    }
  } catch (error) {
    console.error('[synopsis-page-discovery] ScraperAPI request failed:', error)
  }

  try {
    console.log(`[synopsis-page-discovery] Falling back to direct fetch for ${url}`)
    const directResponse = await fetch(url, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    })

    if (!directResponse.ok) {
      console.warn(`[synopsis-page-discovery] Direct fetch error ${directResponse.status} for ${url}`)
    } else {
      const directHtml = await directResponse.text()
      if (directHtml && directHtml.trim().length > 0) {
        return directHtml
      }
      console.warn(`[synopsis-page-discovery] Direct fetch returned empty body for ${url}`)
    }
  } catch (error) {
    console.error('[synopsis-page-discovery] Direct fetch failed:', error)
  }

  try {
    console.log(`[synopsis-page-discovery] Falling back to Jina proxy for ${url}`)
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
      console.warn(`[synopsis-page-discovery] Jina proxy returned empty body for ${url}`)
    } else {
      console.warn(`[synopsis-page-discovery] Jina proxy error ${proxyResponse.status} for ${url}`)
    }
  } catch (error) {
    console.error('[synopsis-page-discovery] Jina proxy fetch failed:', error)
  }

  return null
}

/**
 * Ask GPT-4 with the same configuration as Python version
 */
async function askGPT4(prompt: string): Promise<string> {
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4-turbo',
        messages: [
          {
            role: 'system',
            content: 'You must ensure that you serve valid JSON when asked to give JSON'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7
      })
    })

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`)
    }

    const data = await response.json()
    return data.choices[0].message.content
  } catch (error) {
    console.error('Error calling GPT-4:', error)
    throw error
  }
}

/**
 * Parse important pages response (same logic as Python version)
 */
function parseImportantPagesResponse(response: string): ImportantPage[] {
  try {
    // Extract JSON from response (handles cases where there might be extra text)
    const jsonMatch = response.match(/\[[\s\S]*\]/)
    if (!jsonMatch) {
      throw new Error('No valid JSON array found in response')
    }
    
    const jsonStr = jsonMatch[0]
    const pages = JSON.parse(jsonStr) as ImportantPage[]
    
    // Validate and filter pages
    return pages.filter(page => 
      page.title && 
      page.url && 
      page.category && 
      typeof page.importance === 'number' &&
      page.importance >= 1 && 
      page.importance <= 10
    )
  } catch (error) {
    console.error('Error parsing important pages response:', error)
    console.error('Response was:', response)
    throw new Error(`Failed to parse important pages: ${error.message}`)
  }
}

/**
 * Trigger page crawling for all pending tasks
 */
async function triggerPageCrawling(jobId: string): Promise<void> {
  try {
    // Get all pending page tasks for this job
    const { data: pendingTasks, error: tasksError } = await supabase
      .from('synopsis_page_tasks')
      .select('id')
      .eq('job_id', jobId)
      .eq('status', 'pending')

    if (tasksError) {
      throw new Error(`Failed to get pending tasks: ${tasksError.message}`)
    }

    // Trigger page crawler for each task (parallel processing)
    const crawlPromises = pendingTasks.map(task => 
      fetch(`${supabaseUrl}/functions/v1/synopsis-page-crawler`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          task_id: task.id
        })
      })
    )

    // Execute all crawl requests in parallel
    await Promise.allSettled(crawlPromises)
    
    console.log(`Triggered crawling for ${pendingTasks.length} page tasks`)
  } catch (error) {
    console.error('Error triggering page crawling:', error)
    throw error
  }
}
