import TurndownService from 'npm:turndown'
import { callAnthropic } from './anthropic.ts'
import { resolvePrompt } from './prompts.ts'

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' })

export function htmlToMarkdown(html: string): string {
  return turndown.turndown(html)
}

function extractTemplate(preferences: Record<string, unknown>): string {
  const template = typeof preferences.HTML_Post_Template === 'string' ? preferences.HTML_Post_Template : ''
  return template
}

export async function markdownToHtml(markdown: string, preferences: Record<string, unknown>, regenerate = false, domain?: string | null) {
  const includeConclusion = preferences.include_conclusion ?? true
  const safe = (key: string) => (typeof preferences[key] === 'string' ? String(preferences[key]) : '')

  const promptTemplate = await resolvePrompt(
    regenerate ? 'markdown_to_html_prompt' : 'markdown_to_html_template_prompt',
    { synopsis: preferences, domain },
  )

  const prompt = promptTemplate
    .replaceAll('{include_conclusion}', String(includeConclusion))
    .replaceAll('{post_callout_left}', safe('post_callout_left'))
    .replaceAll('{post_callout_right}', safe('post_callout_right'))
    .replaceAll('{callout_left_cta_dest_url}', safe('callout_left_cta_dest_url'))
    .replaceAll('{callout_right_cta_dest_url}', safe('callout_right_cta_dest_url'))
    .replaceAll('{callout_left_cta_anchor_text}', safe('callout_left_cta_anchor_text'))
    .replaceAll('{callout_right_cta_anchor_text}', safe('callout_right_cta_anchor_text'))
    .replaceAll('{key_takeaways_cta_button}', safe('key_takeaways_cta_button'))
    .replaceAll('{key_takeaways_cta_dest_url}', safe('key_takeaways_cta_dest_url'))
    .replaceAll('{key_takeaways_cta_anchor_text}', safe('key_takeaways_cta_anchor_text'))
    .replaceAll('{quote_wide_text}', safe('quote_wide_text'))
    .replace('{markdown_text}', markdown)
    .replace('{html_template}', extractTemplate(preferences) || '<html><body>{{content}}</body></html>')

  const { text } = await callAnthropic([{ role: 'user', content: prompt }], { maxTokens: 6000, thinking: true })
  return extractFinalHtml(text)
}

function extractFinalHtml(text: string): string {
  if (!text) return ''
  const finalMatch = text.match(/<final_html>([\s\S]*?)<\/final_html>/i)
  if (finalMatch) {
    return finalMatch[1].trim()
  }
  const htmlMatch = text.match(/<!DOCTYPE html>[\s\S]*$/i)
  if (htmlMatch) return htmlMatch[0]
  return text.trim()
}

export function addStyleTag(html: string, synopsis: Record<string, unknown>): string {
  const styleContent = typeof synopsis.post_style_tag_main === 'string'
    ? synopsis.post_style_tag_main
    : typeof synopsis.Post_Style === 'string'
      ? synopsis.Post_Style
      : ''
  if (!styleContent) return html
  if (html.includes('<style')) return html
  return html.replace('<head>', `<head>\n<style>${styleContent}</style>`)
}

export async function inlineImages(html: string): Promise<string> {
  const imageRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi
  const replacements: Array<Promise<{ original: string; replacement: string } | null>> = []

  html.replace(imageRegex, (match, src) => {
    if (!src.startsWith('http')) return match
    replacements.push(fetchDataUri(src).then((dataUri) => ({ original: match, replacement: match.replace(src, dataUri) })).catch(() => null))
    return match
  })

  const results = await Promise.all(replacements)
  let transformed = html
  for (const result of results) {
    if (result) {
      transformed = transformed.replace(result.original, result.replacement)
    }
  }
  return transformed
}

async function fetchDataUri(url: string): Promise<string> {
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`Failed to fetch image ${url}`)
  const contentType = resp.headers.get('content-type') ?? 'image/png'
  const arrayBuffer = await resp.arrayBuffer()
  const bytes = new Uint8Array(arrayBuffer)
  const base64 = btoa(String.fromCharCode(...bytes))
  return `data:${contentType};base64,${base64}`
}

export async function reinstituteCitations(htmlTemplate: string, originalMarkdown: string, synopsis: Record<string, unknown>, domain?: string | null) {
  const promptTemplate = await resolvePrompt('reinstitute_lost_citations_and_references', { synopsis, domain })
  const prompt = promptTemplate
    .replace('{html_template}', htmlTemplate)
    .replace('{markdown_text}', originalMarkdown)
    .replace('{client_name}', (synopsis.client_name as string) ?? '')

  const { text } = await callAnthropic([{ role: 'user', content: prompt }], { maxTokens: 2000 })
  const match = text.match(/<final_html>([\s\S]*?)<\/final_html>/i)
  return match ? match[1].trim() : text.trim()
}
