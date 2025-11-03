import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface Subsection {
  heading: string
  content: string
  content_type: string
}

interface Section {
  heading: string
  subsections: Subsection[]
  content_type: string
}

interface Reference {
  url: string
  title: string
  number: number
  citation: string
}

interface Callout {
  text: string
  cta_url: string
  cta_text: string
}

interface Summary {
  content: string
  key_points: string[]
}

interface RichArticleJson {
  title: string
  summary: Summary
  callouts: {
    left: Callout
    right: Callout
  }
  metadata: {
    word_count: number
    section_count: number
  }
  sections: Section[]
  references: Reference[]
}

/**
 * Extracts key points from the content
 * Looks for important sentences, statements, or actionable items
 */
function extractKeyPoints(sections: Section[]): string[] {
  const keyPoints: string[] = []
  const maxPoints = 7

  // Get the first few sentences from each main section's first subsection
  for (const section of sections.slice(0, Math.ceil(maxPoints / 2))) {
    if (section.subsections.length > 0) {
      const content = section.subsections[0].content
      // Find sentences that look like actionable items or key facts
      const sentences = content.match(/[^.!?]+[.!?]+/g) || []

      for (const sentence of sentences.slice(0, 2)) {
        const trimmed = sentence.trim()
        // Prefer sentences with numbers, specific instructions, or important keywords
        if (trimmed.length > 50 && trimmed.length < 200 &&
            (trimmed.match(/\d+/) ||
             trimmed.toLowerCase().includes('important') ||
             trimmed.toLowerCase().includes('should') ||
             trimmed.toLowerCase().includes('must') ||
             trimmed.toLowerCase().includes('key'))) {
          keyPoints.push(trimmed)
          if (keyPoints.length >= maxPoints) break
        }
      }
      if (keyPoints.length >= maxPoints) break
    }
  }

  // If we didn't get enough key points, add more general sentences
  if (keyPoints.length < 5) {
    for (const section of sections) {
      for (const subsection of section.subsections) {
        const sentences = subsection.content.match(/[^.!?]+[.!?]+/g) || []
        for (const sentence of sentences) {
          const trimmed = sentence.trim()
          if (trimmed.length > 60 && trimmed.length < 180) {
            keyPoints.push(trimmed)
            if (keyPoints.length >= 5) break
          }
        }
        if (keyPoints.length >= 5) break
      }
      if (keyPoints.length >= 5) break
    }
  }

  return keyPoints.slice(0, maxPoints)
}

/**
 * Generates a summary from the first section's content
 */
function generateSummary(sections: Section[]): Summary {
  let summaryContent = ''

  // Use the first section's content as summary base
  if (sections.length > 0 && sections[0].subsections.length > 0) {
    const firstSubsections = sections[0].subsections.slice(0, 2)
    summaryContent = firstSubsections
      .map(sub => sub.content)
      .join(' ')
      .substring(0, 400) + '...'
  }

  const keyPoints = extractKeyPoints(sections)

  return {
    content: summaryContent,
    key_points: keyPoints
  }
}

/**
 * Generates callouts from interesting content snippets
 */
function generateCallouts(sections: Section[]): { left: Callout; right: Callout } {
  const defaultCallout: Callout = {
    text: '',
    cta_url: '#',
    cta_text: 'Learn More'
  }

  const callouts = {
    left: { ...defaultCallout },
    right: { ...defaultCallout }
  }

  // Try to find interesting facts or tips for callouts
  let calloutTexts: string[] = []

  for (const section of sections) {
    for (const subsection of section.subsections) {
      const content = subsection.content
      // Look for sentences that contain interesting facts or tips
      const sentences = content.match(/[^.!?]+[.!?]+/g) || []

      for (const sentence of sentences) {
        const trimmed = sentence.trim()
        // Look for sentences with specific patterns that make good callouts
        if (trimmed.length > 80 && trimmed.length < 200 &&
            (trimmed.includes('—') ||
             trimmed.toLowerCase().includes('tip:') ||
             trimmed.toLowerCase().includes('important') ||
             trimmed.toLowerCase().includes('key'))) {
          calloutTexts.push(trimmed)
          if (calloutTexts.length >= 2) break
        }
      }
      if (calloutTexts.length >= 2) break
    }
    if (calloutTexts.length >= 2) break
  }

  if (calloutTexts.length > 0) {
    callouts.left.text = calloutTexts[0]
  }
  if (calloutTexts.length > 1) {
    callouts.right.text = calloutTexts[1]
  }

  return callouts
}

/**
 * Counts total words in all sections
 */
function countWords(sections: Section[]): number {
  let total = 0
  for (const section of sections) {
    for (const subsection of section.subsections) {
      total += subsection.content.split(/\s+/).filter(w => w.length > 0).length
    }
  }
  return total
}

/**
 * Parses markdown content with references in the format:
 * 1. Citation text - [url](url)
 */
function parseReferences(markdown: string): Reference[] {
  const references: Reference[] = []
  const refSection = markdown.split('## References')[1]

  if (!refSection) return references

  // Match pattern: 1. Citation text - [url](url)
  const refMatches = refSection.matchAll(/(\d+)\.\s+(.+?)\s+-\s+\[([^\]]+)\]\(([^)]+)\)/g)

  for (const match of refMatches) {
    references.push({
      number: parseInt(match[1]),
      citation: match[2].trim(),
      url: match[4].trim(),
      title: match[4].trim()
    })
  }

  return references
}

/**
 * Cleans content by removing markdown headings and converting links to HTML
 */
function cleanContent(content: string): string {
  let cleaned = content

  // Remove any markdown headings (###, ####, etc.) that slipped through
  cleaned = cleaned.replace(/^#{3,6}\s+/gm, '')
  cleaned = cleaned.replace(/\s+#{3,6}\s+/g, ' ')

  // Convert markdown links [text](url) to <a href="url">text</a>
  cleaned = cleaned.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')

  // Convert bare URLs in square brackets [url] to <a href="url">url</a>
  cleaned = cleaned.replace(/\[([^\]]+)\]/g, (match, url) => {
    // Only convert if it looks like a URL
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`
    }
    return match
  })

  return cleaned.trim()
}

/**
 * Parses markdown content into rich JSON structure
 */
function parseMarkdownToRichJson(markdown: string): RichArticleJson {
  const lines = markdown.split('\n')
  const sections: Section[] = []
  let title = ''
  let currentSection: Section | null = null
  let currentSubsection: Subsection | null = null
  let contentBuffer: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()

    // Skip empty lines unless in content
    if (!line && contentBuffer.length === 0) continue

    // Main title (# Title)
    if (line.startsWith('# ') && !title) {
      title = line.substring(2).trim()
      continue
    }

    // Stop at References section
    if (line.startsWith('## References')) {
      break
    }

    // Section title (## Title)
    if (line.startsWith('## ')) {
      // Save previous subsection
      if (currentSubsection && contentBuffer.length > 0) {
        currentSubsection.content = contentBuffer.join(' ').trim()
        contentBuffer = []
      }

      // Save previous section
      if (currentSection) {
        sections.push(currentSection)
      }

      // Extract section heading (everything after ##)
      let sectionHeading = line.substring(3).trim()

      // Check if section heading is suspiciously long (likely has content stuck to it)
      // Typical section headings are < 100 chars. If longer, try to split it.
      if (sectionHeading.length > 100) {
        // Look for where a lowercase letter is directly followed by a capital letter or ###
        // This indicates where heading ends and content/subsection begins
        const splitMatch = sectionHeading.match(/^(.+?[a-z])((?:###|[A-Z]).*)$/)
        if (splitMatch) {
          sectionHeading = splitMatch[1].trim()
          const remainingContent = splitMatch[2].trim()
          // Push back the remaining content as a new line to be processed
          lines.splice(i + 1, 0, remainingContent)
        }
      }

      currentSection = {
        heading: sectionHeading,
        subsections: [],
        content_type: 'section'
      }
      currentSubsection = null
      continue
    }

    // Subsection title (### Title)
    if (line.startsWith('### ')) {
      // Save previous subsection
      if (currentSubsection && contentBuffer.length > 0) {
        currentSubsection.content = cleanContent(contentBuffer.join(' '))
        contentBuffer = []
      }

      // Extract heading (everything after ###)
      let extractedHeading = line.substring(4).trim()

      // Check if heading is suspiciously long (likely has content stuck to it)
      // Typical headings are < 100 chars. If longer, try to split it.
      if (extractedHeading.length > 100) {
        // Look for where a lowercase letter is directly followed by a capital letter (no space)
        // This indicates where heading ends and content begins, e.g., "MetricsContent"
        const splitMatch = extractedHeading.match(/^(.+?[a-z])([A-Z].*)$/)
        if (splitMatch) {
          extractedHeading = splitMatch[1].trim()
          const remainingContent = splitMatch[2].trim()
          // Add the remaining content to buffer so it gets processed
          contentBuffer.push(remainingContent)
        }
      }

      currentSubsection = {
        heading: extractedHeading,
        content: '',
        content_type: 'paragraph'
      }

      if (currentSection) {
        currentSection.subsections.push(currentSubsection)
      }
      continue
    }

    // Accumulate content
    if (currentSubsection && line) {
      contentBuffer.push(line)
    }
  }

  // Save last subsection
  if (currentSubsection && contentBuffer.length > 0) {
    currentSubsection.content = cleanContent(contentBuffer.join(' '))
  }

  // Save last section
  if (currentSection) {
    sections.push(currentSection)
  }

  // Generate metadata
  const wordCount = countWords(sections)
  const sectionCount = sections.length

  // Generate summary and callouts
  const summary = generateSummary(sections)
  const callouts = generateCallouts(sections)

  // Parse references
  const references = parseReferences(markdown)

  return {
    title,
    summary,
    callouts,
    metadata: {
      word_count: wordCount,
      section_count: sectionCount
    },
    sections,
    references
  }
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      }
    )

    const { task_id, content_plan_outline_guid, markdown } = await req.json()

    let markdownContent: string

    // If markdown is provided directly, use it
    if (markdown) {
      markdownContent = markdown
    } else {
      // Validate that at least one identifier is provided
      if (!task_id && !content_plan_outline_guid) {
        return new Response(
          JSON.stringify({
            error: 'Either task_id, content_plan_outline_guid, or markdown must be provided'
          }),
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        )
      }

      // Fetch the unedited_content from tasks table
      let query = supabaseClient
        .from('tasks')
        .select('unedited_content')

      if (task_id) {
        query = query.eq('task_id', task_id)
      } else if (content_plan_outline_guid) {
        query = query.eq('content_plan_outline_guid', content_plan_outline_guid)
      }

      const { data: taskData, error: fetchError } = await query.single()

      if (fetchError) {
        console.error('Error fetching task:', fetchError)
        return new Response(
          JSON.stringify({
            error: 'Task not found',
            details: fetchError.message
          }),
          {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        )
      }

      // Check if unedited_content exists
      if (!taskData.unedited_content) {
        return new Response(
          JSON.stringify({
            error: 'unedited_content is null or empty for this task'
          }),
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        )
      }

      markdownContent = taskData.unedited_content
    }

    // Parse the markdown to rich JSON
    const richJson = parseMarkdownToRichJson(markdownContent)

    // Save to tasks table if task_id was provided
    if (task_id) {
      const { error: updateError } = await supabaseClient
        .from('tasks')
        .update({ post_json: richJson })
        .eq('task_id', task_id)

      if (updateError) {
        console.error('Error saving post_json to tasks:', updateError)
        // Don't fail the request, just log the error
      } else {
        console.log(`Saved post_json to tasks table for task_id: ${task_id}`)
      }
    } else if (content_plan_outline_guid) {
      const { error: updateError } = await supabaseClient
        .from('tasks')
        .update({ post_json: richJson })
        .eq('content_plan_outline_guid', content_plan_outline_guid)

      if (updateError) {
        console.error('Error saving post_json to tasks:', updateError)
      } else {
        console.log(`Saved post_json to tasks table for outline_guid: ${content_plan_outline_guid}`)
      }
    }

    return new Response(
      JSON.stringify(richJson, null, 2),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )

  } catch (error) {
    console.error('Error in markdown-to-rich-json function:', error)
    return new Response(
      JSON.stringify({
        error: error.message || 'Internal server error'
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
})
