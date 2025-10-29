// Supabase Edge Function: synopsis-crawler-fast
// Description: Uses Groq site search to fetch top pages in a single call and primes synopsis pipeline

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders } from "../_shared/cors.ts"
import { Groq } from "https://esm.sh/groq-sdk@0.7.0"
import { delay } from "https://deno.land/std@0.168.0/async/delay.ts"

const supabaseUrl = Deno.env.get('PROJECT_URL') || Deno.env.get('SUPABASE_URL') || ''
const supabaseKey = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const groqApiKey = Deno.env.get('GROQ_API_KEY') || ''

const supabase = createClient(supabaseUrl, supabaseKey)
const groqClient = new Groq({ apiKey: groqApiKey })

interface CrawlerRequest {
  job_id: string
  domain?: string
}

interface GroqPageEntry {
  url?: string
  title?: string
  content_md?: string
  summary?: string
  internal_links?: string[]
}

const MAX_PAGES = 15
const FAST_SOURCE = 'fast'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  let jobId: string | null = null

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

    if (!groqApiKey) {
      throw new Error('GROQ_API_KEY is not configured')
    }

    const { job_id, domain }: CrawlerRequest = await req.json()
    jobId = job_id

    if (!job_id) {
      return new Response(
        JSON.stringify({ error: 'job_id is required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    const job = await fetchJob(job_id)
    if (!job) {
      throw new Error(`Job not found: ${job_id}`)
    }

    if (job.source && job.source !== FAST_SOURCE) {
      console.warn(`[synopsis-crawler-fast] Job ${job_id} source mismatch (${job.source}). Proceeding anyway.`)
    }

    const targetDomain = domain ? normalizeDomain(domain) : job.domain
    const { prompt, rawText, pages } = await fetchAndParseWithRetry(targetDomain, job_id)
    
    if (pages.length === 0) {
      throw new Error('Groq returned no pages to process')
    }

    await storeRawFastResult(job_id, targetDomain, {
      prompt,
      raw_text: rawText,
      parsed_pages: pages
    })

    await supabase
      .from('synopsis_page_tasks')
      .delete()
      .eq('job_id', job_id)

    const now = new Date().toISOString()
    const tasksPayload = pages.slice(0, MAX_PAGES).map((page, index) => {
      const url = normalizeUrl(page.url, targetDomain)
      const importance = Math.max(1, Math.min(10, MAX_PAGES - index))
      return {
        job_id,
        url,
        title: truncate(page.title || url, 255),
        category: 'fast',
        importance,
        status: 'completed',
        markdown_content: page.content_md || '',
        raw_html: markdownToHtml(page.content_md || ''),
        retry_count: 0,
        error_message: null,
        completed_at: now
      }
    })

    const { error: insertError } = await supabase
      .from('synopsis_page_tasks')
      .insert(tasksPayload)

    if (insertError) {
      throw new Error(`Failed to insert page tasks: ${insertError.message}`)
    }

    await supabase
      .from('synopsis_jobs')
      .update({
        total_pages: tasksPayload.length,
        completed_pages: tasksPayload.length,
        status: 'ready_for_analysis',
        updated_at: now
      })
      .eq('id', job_id)

    triggerAnalyzer(job_id).catch((error) => {
      console.error(`[synopsis-crawler-fast] Failed to trigger analyzer for job ${job_id}:`, error)
    })

    return new Response(
      JSON.stringify({
        success: true,
        message: `Fast crawler processed ${tasksPayload.length} pages`,
        job_id,
        domain: targetDomain
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  } catch (error) {
    console.error('[synopsis-crawler-fast] Error:', error)

    if (jobId) {
      if (lastGroqSnapshot.jobId === jobId && lastGroqSnapshot.rawText) {
        await storeRawFastResult(jobId, lastGroqSnapshot.domain, {
          prompt: lastGroqSnapshot.prompt,
          raw_text: lastGroqSnapshot.rawText,
          error: (error as Error).message ?? 'unknown error'
        })
      }

      await supabase
        .from('synopsis_jobs')
        .update({
          status: 'failed',
          error_message: `Fast crawler failed: ${(error as Error).message}`
        })
        .eq('id', jobId)
    }

    return new Response(
      JSON.stringify({ success: false, error: (error as Error).message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})

async function fetchJob(jobId: string) {
  const { data, error } = await supabase
    .from('synopsis_jobs')
    .select('*')
    .eq('id', jobId)
    .single()

  if (error) {
    console.error('[synopsis-crawler-fast] Error fetching job:', error)
    return null
  }

  return data
}

let lastGroqSnapshot: {
  jobId: string | null
  domain: string
  prompt: string
  rawText: string | null
} = { jobId: null, domain: '', prompt: '', rawText: null }

async function fetchGroqSiteSummary(domain: string): Promise<{ prompt: string; rawText: string }> {
  const prompt = `You will use your web search tool to perform a site search on the site https://${domain}. The search will be site:${domain}. For each of the top 15 pages you will give me the title, the full page content in markdown, a summary of the content and any important internal links that you find. Return this in a json object in the shape of [  {\n    "url": "",\n    "title": "",\n    "content_md": "",\n    "summary": "",\n    "internal_links": [\n      "/link",\n      "/link2"\n    ]\n  }\n] in a <final_answer>`

  const completion = await groqClient.chat.completions.create({
    messages: [
      {
        role: 'user',
        content: prompt
      }
    ],
    model: 'openai/gpt-oss-120b',
    temperature: 1,
    max_completion_tokens: 65536,
    top_p: 1,
    stream: true,
    reasoning_effort: 'medium',
    tools: [
      { type: 'browser_search' },
      { type: 'code_interpreter' }
    ]
  })

  let fullText = ''
  for await (const chunk of completion) {
    const content = chunk.choices[0]?.delta?.content
    if (content) {
      fullText += content
    }
  }

  return { prompt, rawText: fullText }
}

/**
 * Fetch AND parse with retry logic - retries cover both API failures and parsing failures
 */
async function fetchAndParseWithRetry(
  domain: string, 
  jobId: string,
  maxAttempts = 5
): Promise<{ prompt: string; rawText: string; pages: GroqPageEntry[] }> {
  let lastError: unknown = null

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`[synopsis-crawler-fast] Attempt ${attempt}/${maxAttempts} for ${domain}`)
      
      // Fetch from Groq
      const { prompt, rawText } = await fetchGroqSiteSummary(domain)
      
      // Log it
      logPromptAndResponse(jobId, domain, prompt, rawText)
      
      // Validate response is not empty
      if (!rawText || rawText.trim().length === 0) {
        throw new Error('Groq returned empty response')
      }
      
      // Try to parse
      const pages = parseGroqPages(rawText, domain)
      
      // Validate we got actual pages
      if (!pages || pages.length === 0) {
        throw new Error('Groq response contained no valid pages')
      }
      
      console.log(`[synopsis-crawler-fast] ✅ Success on attempt ${attempt}: got ${pages.length} pages`)
      return { prompt, rawText, pages }
      
    } catch (error) {
      lastError = error
      const isLastAttempt = attempt === maxAttempts
      const errorMsg = (error as Error).message || String(error)
      
      console.warn(
        `[synopsis-crawler-fast] ❌ Attempt ${attempt}/${maxAttempts} failed for ${domain}: ${errorMsg}`
      )

      if (isLastAttempt) {
        console.error(`[synopsis-crawler-fast] 🚨 All ${maxAttempts} attempts failed for ${domain}`)
        throw error
      }

      // Exponential backoff: 2s, 4s, 8s, 16s (capped at 16s)
      const backoffMs = Math.min(2000 * Math.pow(2, attempt - 1), 16000)
      console.log(`[synopsis-crawler-fast] ⏳ Retrying in ${backoffMs}ms...`)
      await delay(backoffMs)
    }
  }

  throw lastError ?? new Error('Unknown error fetching and parsing Groq site summary')
}

/**
 * @deprecated Use fetchAndParseWithRetry instead
 */
async function fetchGroqSiteSummaryWithRetry(domain: string, maxAttempts = 3): Promise<{ prompt: string; rawText: string }> {
  let lastError: unknown = null

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await fetchGroqSiteSummary(domain)
      return result
    } catch (error) {
      lastError = error
      const isLastAttempt = attempt === maxAttempts
      console.warn(`[synopsis-crawler-fast] Groq fetch attempt ${attempt} failed for ${domain}:`, error)

      if (isLastAttempt) {
        throw error
      }

      const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 8000)
      await delay(backoffMs)
    }
  }

  throw lastError ?? new Error('Unknown error fetching Groq site summary')
}

function parseGroqPages(responseText: string, domain: string): GroqPageEntry[] {
  const finalAnswer = extractFinalAnswer(responseText)
  if (!finalAnswer) {
    throw new Error('Unable to locate <final_answer> block in Groq response')
  }

  try {
    const parsed = JSON.parse(finalAnswer) as GroqPageEntry[]
    return parsed
      .filter((entry) => typeof entry === 'object' && entry !== null)
      .map((entry) => ({
        url: entry.url || '',
        title: entry.title || '',
        content_md: entry.content_md || '',
        summary: entry.summary || '',
        internal_links: Array.isArray(entry.internal_links) ? entry.internal_links.filter((link) => typeof link === 'string') : []
      }))
      .filter((entry) => entry.url && entry.content_md)
  } catch (error) {
    console.error('[synopsis-crawler-fast] Failed to parse Groq JSON:', error)
    throw new Error('Groq returned invalid JSON payload')
  }
}

function extractFinalAnswer(text: string): string | null {
  const match = text.match(/<final_answer>([\s\S]*?)<\/final_answer>/i)
  if (match && match[1]) {
    return match[1].trim()
  }
  const jsonBlock = text.match(/```json\s*([\s\S]*?)```/i)
  if (jsonBlock && jsonBlock[1]) {
    return jsonBlock[1].trim()
  }
  try {
    JSON.parse(text)
    return text.trim()
  } catch (_error) {
    return null
  }
}

async function storeRawFastResult(jobId: string, domain: string, payload: Record<string, unknown>): Promise<void> {
  const { error } = await supabase
    .from('synopsis_fast_results')
    .insert({
      job_id: jobId,
      domain,
      raw_json: payload
    })

  if (error) {
    console.error('[synopsis-crawler-fast] Failed to store raw fast result:', error)
  }
}

function logPromptAndResponse(jobId: string, domain: string, prompt: string, rawText: string): void {
  lastGroqSnapshot = { jobId, domain, prompt, rawText }
  console.log(`[synopsis-crawler-fast] Groq prompt for ${domain}: ${prompt}`)
  const preview = rawText.length > 500 ? `${rawText.slice(0, 500)}…` : rawText
  console.log(`[synopsis-crawler-fast] Groq raw response preview (${rawText.length} chars): ${preview}`)
}

function markdownToHtml(markdown: string): string {
  if (!markdown) {
    return ''
  }

  const escaped = markdown
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  return `<pre>${escaped}</pre>`
}

function normalizeDomain(domain: string): string {
  return domain
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '')
}

function normalizeUrl(url: string | undefined, domain: string): string {
  if (!url) {
    return `https://${domain}`
  }

  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url
  }

  if (url.startsWith('/')) {
    return `https://${domain}${url}`
  }

  return `https://${domain}/${url}`
}

function truncate(value: string, max: number): string {
  if (value.length <= max) {
    return value
  }
  return value.slice(0, max - 3) + '...'
}

async function triggerAnalyzer(jobId: string): Promise<void> {
  try {
    await fetch(`${supabaseUrl}/functions/v1/synopsis-analyzer`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ job_id: jobId })
    })
  } catch (error) {
    console.error('[synopsis-crawler-fast] Error triggering analyzer:', error)
  }
}
