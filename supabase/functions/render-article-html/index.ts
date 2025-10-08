import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface SubsectionStructure {
  title: string
  content: string
}

interface SectionStructure {
  title: string
  subsections: SubsectionStructure[]
}

interface ReferenceStructure {
  number: number
  citation: string
  url: string
}

interface JsonArticle {
  title: string
  sections: SectionStructure[]
  references: ReferenceStructure[]
}

/**
 * Generates a URL-friendly slug from a title
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
}

/**
 * Generates Table of Contents HTML from sections
 */
function generateTOC(sections: SectionStructure[]): string {
  let html = '<ul class="toc-list">\n'

  for (const section of sections) {
    const sectionSlug = slugify(section.title)
    html += `  <li><a href="#${sectionSlug}">${section.title}</a></li>\n`

    if (section.subsections.length > 0) {
      html += '  <ul class="toc-subsections">\n'
      for (const subsection of section.subsections) {
        const subsectionSlug = slugify(subsection.title)
        html += `    <li><a href="#${subsectionSlug}">${subsection.title}</a></li>\n`
      }
      html += '  </ul>\n'
    }
  }

  html += '</ul>'
  return html
}

/**
 * Generates body content HTML from sections
 */
function generateBodyContent(sections: SectionStructure[]): string {
  let html = ''

  for (const section of sections) {
    const sectionSlug = slugify(section.title)
    html += `        <section id="${sectionSlug}">\n`
    html += `          <h2>${section.title}</h2>\n`

    for (const subsection of section.subsections) {
      const subsectionSlug = slugify(subsection.title)
      html += `          <div id="${subsectionSlug}">\n`
      html += `            <h3>${subsection.title}</h3>\n`
      html += `            <p>${subsection.content}</p>\n`
      html += `          </div>\n`
    }

    html += `        </section>\n\n`
  }

  return html
}

/**
 * Generates references HTML
 */
function generateReferences(references: ReferenceStructure[]): string {
  if (references.length === 0) return ''

  let html = '        <section id="references">\n'
  html += '          <h2>References</h2>\n'
  html += '          <ol class="references-list">\n'

  for (const ref of references) {
    html += `            <li id="ref-${ref.number}">\n`
    html += `              ${ref.citation} - <a href="${ref.url}" target="_blank" rel="noopener noreferrer">${ref.url}</a>\n`
    html += `            </li>\n`
  }

  html += '          </ol>\n'
  html += '        </section>'

  return html
}

/**
 * Renders the article JSON into the HTML template
 */
function renderArticleHTML(article: JsonArticle, template: string): string {
  const toc = generateTOC(article.sections)
  const bodyContent = generateBodyContent(article.sections)
  const references = generateReferences(article.references)

  // Calculate read time (rough estimate: 200 words per minute)
  const totalWords = article.sections.reduce((count, section) => {
    return count + section.subsections.reduce((subCount, subsection) => {
      return subCount + subsection.content.split(/\s+/).length
    }, 0)
  }, 0)
  const readTime = Math.ceil(totalWords / 200)

  // Replace placeholders
  let html = template
    .replace(/{{TITLE_TAG}}/g, article.title)
    .replace(/{{META_DESCRIPTION}}/g, article.sections[0]?.subsections[0]?.content.substring(0, 155) + '...' || article.title)
    .replace(/{{HEADLINE}}/g, article.title)
    .replace(/{{TOC_SECTION}}/g, toc)
    .replace(/{{BODY_CONTENT}}/g, bodyContent)
    .replace(/{{REFERENCES}}/g, references)
    .replace(/{{READ_TIME}}/g, `${readTime} min read`)
    .replace(/{{DATE}}/g, new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }))
    // Default placeholders for optional fields
    .replace(/{{JSON_LD}}/g, '')
    .replace(/{{LEAD_IMAGE_URL}}/g, '')
    .replace(/{{LEAD_IMAGE_ALT}}/g, article.title)
    .replace(/{{BYLINE_URL}}/g, '#')
    .replace(/{{BYLINE_NAME}}/g, 'Author')
    .replace(/{{ABOUT_COMPANY_TEXT}}/g, '')
    .replace(/{{SOCIAL_LINKS}}/g, '')
    .replace(/{{SUMMARY_SECTION}}/g, '')
    .replace(/{{KEY_TAKEAWAYS}}/g, '')

  return html
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

    const { task_id, content_plan_outline_guid, article_json } = await req.json()

    let articleJson: JsonArticle

    // If article_json is provided directly, use it
    if (article_json) {
      articleJson = article_json
    } else {
      // Otherwise, fetch from database
      if (!task_id && !content_plan_outline_guid) {
        return new Response(
          JSON.stringify({
            error: 'Either task_id, content_plan_outline_guid, or article_json must be provided'
          }),
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        )
      }

      // Call the markdown-to-json function to get the JSON
      const markdownToJsonUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/markdown-to-json`
      const markdownResponse = await fetch(markdownToJsonUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
        },
        body: JSON.stringify({ task_id, content_plan_outline_guid })
      })

      if (!markdownResponse.ok) {
        const errorData = await markdownResponse.json()
        return new Response(
          JSON.stringify({
            error: 'Failed to convert markdown to JSON',
            details: errorData
          }),
          {
            status: markdownResponse.status,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        )
      }

      articleJson = await markdownResponse.json()
    }

    // Fetch the HTML template
    // First, get the domain from the task to look up the template
    let template: string
    let domainName: string | null = null

    // If we have task_id or content_plan_outline_guid, fetch the domain
    if (task_id || content_plan_outline_guid) {
      let taskQuery = supabaseClient
        .from('tasks')
        .select('domain')

      if (task_id) {
        taskQuery = taskQuery.eq('task_id', task_id)
      } else {
        taskQuery = taskQuery.eq('content_plan_outline_guid', content_plan_outline_guid)
      }

      const { data: taskInfo } = await taskQuery.single()
      domainName = taskInfo?.domain
    }

    // Try to get the template from domain preferences
    if (domainName) {
      const { data: domainPrefs } = await supabaseClient
        .from('domain_preferences')
        .select('HTML_Post_Template')
        .eq('domain', domainName)
        .single()

      if (domainPrefs?.HTML_Post_Template) {
        template = domainPrefs.HTML_Post_Template
        console.log(`Using HTML_Post_Template from domain preferences for ${domainName}`)
      }
    }

    // If no template from domain preferences, fetch the default template
    if (!template) {
      const defaultTemplateUrl = 'https://jsypctdhynsdqrfifvdh.supabase.co/storage/v1/object/public/cp-downloads/mrb-template.html'
      console.log('Fetching default template from storage')

      try {
        const templateResponse = await fetch(defaultTemplateUrl)
        if (templateResponse.ok) {
          template = await templateResponse.text()
        } else {
          throw new Error(`Failed to fetch template: ${templateResponse.status}`)
        }
      } catch (error) {
        console.error('Error fetching default template:', error)
        // Fallback to basic inline template
        template = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{TITLE_TAG}}</title>
  <meta name="description" content="{{META_DESCRIPTION}}">
</head>
<body>
  <h1>{{HEADLINE}}</h1>
  <div>{{READ_TIME}}</div>
  <nav>{{TOC_SECTION}}</nav>
  <main>{{BODY_CONTENT}}</main>
  {{REFERENCES}}
</body>
</html>`
      }
    }

    // Render the article
    const renderedHTML = renderArticleHTML(articleJson, template)

    return new Response(renderedHTML, {
      headers: { ...corsHeaders, 'Content-Type': 'text/html' },
    })

  } catch (error) {
    console.error('Error in render-article-html function:', error)
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
