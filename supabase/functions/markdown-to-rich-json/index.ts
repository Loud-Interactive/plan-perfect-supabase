import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { callGroqWithLogging } from '../utils/groq-logging.ts';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

/**
 * Helper function to update task status
 */
async function updateTaskStatus(
  supabaseClient: any,
  taskId: string | null,
  outlineGuid: string | null,
  status: string
): Promise<void> {
  if (!taskId && !outlineGuid) return;
  
  try {
    if (taskId) {
      await supabaseClient
        .from('tasks')
        .update({ status })
        .eq('task_id', taskId);
    } else if (outlineGuid) {
      await supabaseClient
        .from('tasks')
        .update({ status })
        .eq('content_plan_outline_guid', outlineGuid);
    }
    console.log(`[Status] Updated to: ${status}`);
  } catch (error) {
    console.warn(`[Status] Failed to update status to ${status}:`, error);
  }
}
/**
 * Generates key points from the content using Groq Kimi K2
 */ async function generateKeyPoints(sections, title, groqApiKey, domain) {
  // Combine all section content for context (limit to reasonable size)
  const contentText = sections.slice(0, 10) // Use first 10 sections max
  .map((section)=>{
    const sectionContent = section.subsections.slice(0, 3) // Use first 3 subsections per section
    .map((sub)=>sub.content).join(' ');
    return `## ${section.heading}\n${sectionContent}`;
  }).join('\n\n').substring(0, 8000) // Limit to 8000 chars for API
  ;
  const prompt = `Analyze this article and extract the most important key points.

Article Title: ${title}

Article Content:
${contentText}

Requirements:
- Extract 5-7 key points that capture the most important information
- Each key point should be a complete, concise sentence (50-150 characters)
- Focus on actionable insights, important facts, or critical takeaways
- Make each point distinct and valuable
- Avoid generic statements
- Return ONLY a JSON array of strings, like: ["point 1", "point 2", "point 3"]

Example format:
["Key point one sentence", "Key point two sentence", "Key point three sentence"]

Return the JSON array only, no other text.`;
  try {
    const result = await callGroqWithLogging('generate-key-points', prompt, groqApiKey, domain, {
      modelName: 'moonshotai/kimi-k2-instruct-0905',
      temperature: 0.7,
      maxTokens: 800
    });
    const responseText = result.response.trim();
    // Try to parse as JSON array
    try {
      // Remove any markdown code blocks if present
      const cleaned = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const keyPoints = JSON.parse(cleaned);
      if (Array.isArray(keyPoints) && keyPoints.length > 0) {
        // Validate and clean key points
        const validPoints = keyPoints.filter((point)=>typeof point === 'string' && point.length > 20 && point.length < 200).slice(0, 7) // Limit to 7 points max
        ;
        console.log(`[generateKeyPoints] Generated ${validPoints.length} key points using AI`);
        return validPoints;
      }
    } catch (parseError) {
      console.warn(`[generateKeyPoints] Failed to parse JSON, trying to extract from text:`, parseError);
      // Fallback: try to extract list items from text
      const lines = responseText.split('\n').map((line)=>line.trim()).filter((line)=>line.length > 20 && line.length < 200).filter((line)=>line.match(/^[-*•]\s+/) || line.match(/^\d+\.\s+/)).map((line)=>line.replace(/^[-*•]\s+/, '').replace(/^\d+\.\s+/, '')).slice(0, 7);
      if (lines.length > 0) {
        console.log(`[generateKeyPoints] Extracted ${lines.length} key points from text fallback`);
        return lines;
      }
    }
    // Final fallback: return empty array
    console.warn('[generateKeyPoints] Could not extract key points, returning empty array');
    return [];
  } catch (error) {
    console.error('[generateKeyPoints] Error generating key points:', error);
    return [];
  }
}
/**
 * Generates a summary using Groq Kimi K2
 */ async function generateSummary(sections, title, groqApiKey, domain) {
  // Combine content from first few sections for context
  const contentText = sections.slice(0, 5) // Use first 5 sections
  .map((section)=>{
    const sectionContent = section.subsections.slice(0, 2) // Use first 2 subsections per section
    .map((sub)=>sub.content).join(' ');
    return `## ${section.heading}\n${sectionContent}`;
  }).join('\n\n').substring(0, 6000) // Limit to 6000 chars for API
  ;
  const prompt = `Write a comprehensive summary paragraph for this article.

Article Title: ${title}

Article Content:
${contentText}

Requirements:
- Write a full paragraph (4-6 sentences, 200-400 words)
- Capture the essence and main value proposition of the article
- Be engaging and informative
- Highlight what readers will learn and why it matters
- Use active voice and flow naturally
- Make it comprehensive yet concise
- Focus on the key topics and insights covered

Return ONLY the summary paragraph, nothing else. Do not include a title or any other text.`;
  try {
    const result = await callGroqWithLogging('generate-summary', prompt, groqApiKey, domain, {
      modelName: 'moonshotai/kimi-k2-instruct-0905',
      temperature: 0.7,
      maxTokens: 500
    });
    const summaryContent = result.response.trim();
    if (summaryContent && summaryContent.length > 50) {
      // Generate key points in parallel
      const keyPoints = await generateKeyPoints(sections, title, groqApiKey, domain);
      console.log(`[generateSummary] Generated summary (${summaryContent.length} chars) and ${keyPoints.length} key points using AI`);
      return {
        content: summaryContent,
        key_points: keyPoints
      };
    }
    // Fallback if summary is too short
    throw new Error('Generated summary too short');
  } catch (error) {
    console.error('[generateSummary] Error generating summary:', error);
    // Fallback: use first section content
    let summaryContent = '';
    if (sections.length > 0 && sections[0].subsections.length > 0) {
      const firstSubsections = sections[0].subsections.slice(0, 2);
      summaryContent = firstSubsections.map((sub)=>sub.content).join(' ').substring(0, 400) + '...';
    }
    // Fallback key points
    const keyPoints = await generateKeyPoints(sections, title, groqApiKey, domain).catch(()=>[]);
    return {
      content: summaryContent || `This comprehensive guide explores ${title}, covering key aspects and providing valuable insights.`,
      key_points: keyPoints
    };
  }
}
/**
 * Generates callouts from interesting content snippets
 */ function generateCallouts(sections) {
  const defaultCallout = {
    text: '',
    cta_url: '#',
    cta_text: 'Learn More'
  };
  const callouts = {
    left: {
      ...defaultCallout
    },
    right: {
      ...defaultCallout
    }
  };
  // Try to find interesting facts or tips for callouts
  let calloutTexts = [];
  for (const section of sections){
    for (const subsection of section.subsections){
      const content = subsection.content;
      // Look for sentences that contain interesting facts or tips
      const sentences = content.match(/[^.!?]+[.!?]+/g) || [];
      for (const sentence of sentences){
        const trimmed = sentence.trim();
        // Look for sentences with specific patterns that make good callouts
        if (trimmed.length > 80 && trimmed.length < 200 && (trimmed.includes('—') || trimmed.toLowerCase().includes('tip:') || trimmed.toLowerCase().includes('important') || trimmed.toLowerCase().includes('key'))) {
          calloutTexts.push(trimmed);
          if (calloutTexts.length >= 2) break;
        }
      }
      if (calloutTexts.length >= 2) break;
    }
    if (calloutTexts.length >= 2) break;
  }
  if (calloutTexts.length > 0) {
    callouts.left.text = calloutTexts[0];
  }
  if (calloutTexts.length > 1) {
    callouts.right.text = calloutTexts[1];
  }
  return callouts;
}
/**
 * Counts total words in all sections
 */ function countWords(sections) {
  let total = 0;
  for (const section of sections){
    for (const subsection of section.subsections){
      total += subsection.content.split(/\s+/).filter((w)=>w.length > 0).length;
    }
  }
  return total;
}
/**
 * Parses markdown content with references in the format:
 * 1. Citation text - [url](url)
 */ function parseReferences(markdown) {
  const references = [];
  const refSection = markdown.split('## References')[1];
  if (!refSection) return references;
  // Match pattern: 1. Citation text - [url](url)
  const refMatches = refSection.matchAll(/(\d+)\.\s+(.+?)\s+-\s+\[([^\]]+)\]\(([^)]+)\)/g);
  for (const match of refMatches){
    references.push({
      number: parseInt(match[1]),
      citation: match[2].trim(),
      url: match[4].trim(),
      title: match[4].trim()
    });
  }
  return references;
}
/**
 * Cleans content by removing markdown headings and converting links to HTML
 */ function cleanContent(content) {
  let cleaned = content;
  // Remove any markdown headings (###, ####, etc.) that slipped through
  cleaned = cleaned.replace(/^#{3,6}\s+/gm, '');
  cleaned = cleaned.replace(/\s+#{3,6}\s+/g, ' ');
  // Convert markdown links [text](url) to <a href="url">text</a>
  cleaned = cleaned.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  // Convert bare URLs in square brackets [url] to <a href="url">url</a>
  cleaned = cleaned.replace(/\[([^\]]+)\]/g, (match, url)=>{
    // Only convert if it looks like a URL
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
    }
    return match;
  });
  return cleaned.trim();
}
/**
 * Parses markdown content into rich JSON structure
 */ async function parseMarkdownToRichJson(
  markdown: string,
  groqApiKey: string,
  domain: string | undefined,
  supabaseClient: any,
  taskId: string | null,
  outlineGuid: string | null
) {
  const lines = markdown.split('\n');
  const sections = [];
  let title = '';
  let currentSection = null;
  let currentSubsection = null;
  let contentBuffer = [];
  for(let i = 0; i < lines.length; i++){
    const line = lines[i].trim();
    // Skip empty lines unless in content
    if (!line && contentBuffer.length === 0) continue;
    // Main title (# Title)
    if (line.startsWith('# ') && !title) {
      title = line.substring(2).trim();
      continue;
    }
    // Stop at References section
    if (line.startsWith('## References')) {
      break;
    }
    // Section title (## Title)
    if (line.startsWith('## ')) {
      // Save previous subsection
      if (currentSubsection && contentBuffer.length > 0) {
        currentSubsection.content = contentBuffer.join(' ').trim();
        contentBuffer = [];
      }
      // Save previous section
      if (currentSection) {
        sections.push(currentSection);
      }
      // Extract section heading (everything after ##)
      let sectionHeading = line.substring(3).trim();
      // Check if section heading is suspiciously long (likely has content stuck to it)
      // Typical section headings are < 100 chars. If longer, try to split it.
      if (sectionHeading.length > 100) {
        // Look for where a lowercase letter is directly followed by a capital letter or ###
        // This indicates where heading ends and content/subsection begins
        const splitMatch = sectionHeading.match(/^(.+?[a-z])((?:###|[A-Z]).*)$/);
        if (splitMatch) {
          sectionHeading = splitMatch[1].trim();
          const remainingContent = splitMatch[2].trim();
          // Push back the remaining content as a new line to be processed
          lines.splice(i + 1, 0, remainingContent);
        }
      }
      currentSection = {
        heading: sectionHeading,
        subsections: [],
        content_type: 'section'
      };
      currentSubsection = null;
      continue;
    }
    // Subsection title (### Title)
    if (line.startsWith('### ')) {
      // Save previous subsection
      if (currentSubsection && contentBuffer.length > 0) {
        currentSubsection.content = cleanContent(contentBuffer.join(' '));
        contentBuffer = [];
      }
      // Extract heading (everything after ###)
      let extractedHeading = line.substring(4).trim();
      // Check if heading is suspiciously long (likely has content stuck to it)
      // Typical headings are < 100 chars. If longer, try to split it.
      if (extractedHeading.length > 100) {
        // Look for where a lowercase letter is directly followed by a capital letter (no space)
        // This indicates where heading ends and content begins, e.g., "MetricsContent"
        const splitMatch = extractedHeading.match(/^(.+?[a-z])([A-Z].*)$/);
        if (splitMatch) {
          extractedHeading = splitMatch[1].trim();
          const remainingContent = splitMatch[2].trim();
          // Add the remaining content to buffer so it gets processed
          contentBuffer.push(remainingContent);
        }
      }
      currentSubsection = {
        heading: extractedHeading,
        content: '',
        content_type: 'paragraph'
      };
      if (currentSection) {
        currentSection.subsections.push(currentSubsection);
      }
      continue;
    }
    // Accumulate content
    if (currentSubsection && line) {
      contentBuffer.push(line);
    }
  }
  // Save last subsection
  if (currentSubsection && contentBuffer.length > 0) {
    currentSubsection.content = cleanContent(contentBuffer.join(' '));
  }
  // Save last section
  if (currentSection) {
    sections.push(currentSection);
  }
  // Generate metadata
  const wordCount = countWords(sections);
  const sectionCount = sections.length;
  
  // Update status: generating summary with AI
  await updateTaskStatus(supabaseClient, taskId, outlineGuid, 'generating_summary');
  
  // Generate summary and callouts using AI
  const summary = await generateSummary(sections, title, groqApiKey, domain);
  const callouts = generateCallouts(sections);
  // Parse references
  const references = parseReferences(markdown);
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
  };
}
serve(async (req)=>{
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    const supabaseClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });
    const { task_id, content_plan_outline_guid, markdown } = await req.json();
    
    // Update status: starting conversion
    await updateTaskStatus(supabaseClient, task_id, content_plan_outline_guid, 'converting_markdown_to_json');
    
    // Get Groq API key
    const groqApiKey = Deno.env.get('GROQ_API_KEY') || '';
    if (!groqApiKey) {
      console.warn('GROQ_API_KEY not set, AI-generated summaries will use fallback');
    }
    let markdownContent;
    let domain;
    // If markdown is provided directly, use it
    if (markdown) {
      markdownContent = markdown;
    } else {
      // Update status: fetching markdown
      await updateTaskStatus(supabaseClient, task_id, content_plan_outline_guid, 'fetching_markdown');
      // Validate that at least one identifier is provided
      if (!task_id && !content_plan_outline_guid) {
        return new Response(JSON.stringify({
          error: 'Either task_id, content_plan_outline_guid, or markdown must be provided'
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
      // Fetch the unedited_content and client_domain from tasks table
      let query = supabaseClient.from('tasks').select('unedited_content, client_domain');
      if (task_id) {
        query = query.eq('task_id', task_id);
      } else if (content_plan_outline_guid) {
        query = query.eq('content_plan_outline_guid', content_plan_outline_guid);
      }
      const { data: taskData, error: fetchError } = await query.single();
      if (fetchError) {
        console.error('Error fetching task:', fetchError);
        return new Response(JSON.stringify({
          error: 'Task not found',
          details: fetchError.message
        }), {
          status: 404,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
      // Check if unedited_content exists
      if (!taskData.unedited_content) {
        return new Response(JSON.stringify({
          error: 'unedited_content is null or empty for this task'
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
      markdownContent = taskData.unedited_content;
      domain = taskData.client_domain;
    }
    
    // Update status: parsing markdown
    await updateTaskStatus(supabaseClient, task_id, content_plan_outline_guid, 'parsing_markdown');
    
    // Parse the markdown to rich JSON using AI for summary and key points
    const richJson = await parseMarkdownToRichJson(markdownContent, groqApiKey, domain, supabaseClient, task_id, content_plan_outline_guid);
    
    // Update status: saving JSON
    await updateTaskStatus(supabaseClient, task_id, content_plan_outline_guid, 'saving_json');
    
    // Save to tasks table if task_id was provided
    if (task_id) {
      const { error: updateError } = await supabaseClient.from('tasks').update({
        post_json: richJson
      }).eq('task_id', task_id);
      if (updateError) {
        console.error('Error saving post_json to tasks:', updateError);
      // Don't fail the request, just log the error
      } else {
        console.log(`Saved post_json to tasks table for task_id: ${task_id}`);
      }
    } else if (content_plan_outline_guid) {
      const { error: updateError } = await supabaseClient.from('tasks').update({
        post_json: richJson
      }).eq('content_plan_outline_guid', content_plan_outline_guid);
      if (updateError) {
        console.error('Error saving post_json to tasks:', updateError);
      } else {
        console.log(`Saved post_json to tasks table for outline_guid: ${content_plan_outline_guid}`);
      }
    }
    
    // Update status: conversion complete
    await updateTaskStatus(supabaseClient, task_id, content_plan_outline_guid, 'json_conversion_complete');
    
    return new Response(JSON.stringify(richJson, null, 2), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Error in markdown-to-rich-json function:', error);
    return new Response(JSON.stringify({
      error: error.message || 'Internal server error'
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
