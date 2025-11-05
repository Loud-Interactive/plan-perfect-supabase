import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { callGroqWithLogging } from '../utils/groq-logging.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
};

interface Section {
  heading: string;
  subsections: Array<{
    title: string;
    content: string;
  }>;
}

interface Summary {
  content: string;
  key_points: string[];
}

interface RichArticleJson {
  title: string;
  summary: Summary;
  sections: Section[];
  references: Array<{
    number: number;
    citation: string;
    url: string;
  }>;
  metadata?: {
    word_count: number;
    section_count: number;
  };
}

/**
 * Generates key points from the content using Groq Kimi K2
 */
async function generateKeyPoints(
  sections: Section[],
  title: string,
  groqApiKey: string,
  domain?: string
): Promise<string[]> {
  // Combine all section content for context (full article)
  const contentText = sections
    .map(section => {
      const sectionContent = section.subsections
        .map(sub => sub.content)
        .join(' ');
      return `## ${section.heading}\n${sectionContent}`;
    })
    .join('\n\n');

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
- DO NOT include callouts, promotional content, or marketing messages in the key points
- Key points should be factual insights from the article content, not sales pitches or promotional statements
- Return ONLY a JSON array of strings, like: ["point 1", "point 2", "point 3"]

Example format:
["Key point one sentence", "Key point two sentence", "Key point three sentence"]

Return the JSON array only, no other text.`;

  try {
    const result = await callGroqWithLogging(
      'generate-key-points',
      prompt,
      groqApiKey,
      domain,
      {
        modelName: 'moonshotai/kimi-k2-instruct-0905',
        temperature: 0.7,
        maxTokens: 800
      }
    );

    const responseText = result.response.trim();

    // Try to parse as JSON array
    try {
      // Remove any markdown code blocks if present
      const cleaned = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const keyPoints = JSON.parse(cleaned) as string[];

      if (Array.isArray(keyPoints) && keyPoints.length > 0) {
        // Validate and clean key points
        const validPoints = keyPoints
          .filter((point: any) => typeof point === 'string' && point.length > 20 && point.length < 200)
          .slice(0, 7); // Limit to 7 points max

        console.log(`[generateKeyPoints] Generated ${validPoints.length} key points using AI`);
        return validPoints;
      }
    } catch (parseError) {
      console.warn(`[generateKeyPoints] Failed to parse JSON, trying to extract from text:`, parseError);

      // Fallback: try to extract list items from text
      const lines = responseText.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 20 && line.length < 200)
        .filter(line => line.match(/^[-*•]\s+/) || line.match(/^\d+\.\s+/))
        .map(line => line.replace(/^[-*•]\s+/, '').replace(/^\d+\.\s+/, ''))
        .slice(0, 7);

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
 */
async function generateSummary(
  sections: Section[],
  title: string,
  groqApiKey: string,
  domain?: string
): Promise<Summary> {
  // Combine content from all sections for context (full article)
  const contentText = sections
    .map(section => {
      const sectionContent = section.subsections
        .map(sub => sub.content)
        .join(' ');
      return `## ${section.heading}\n${sectionContent}`;
    })
    .join('\n\n');

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
    const result = await callGroqWithLogging(
      'generate-summary',
      prompt,
      groqApiKey,
      domain,
      {
        modelName: 'moonshotai/kimi-k2-instruct-0905',
        temperature: 0.7,
        maxTokens: 500
      }
    );

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
      summaryContent = firstSubsections
        .map(sub => sub.content)
        .join(' ')
        .substring(0, 400) + '...';
    }

    // Fallback key points
    const keyPoints = await generateKeyPoints(sections, title, groqApiKey, domain).catch(() => []);

    return {
      content: summaryContent || `This comprehensive guide explores ${title}, covering key aspects and providing valuable insights.`,
      key_points: keyPoints
    };
  }
}

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
 * Count words in sections
 */
function countWords(sections: Section[]): number {
  return sections.reduce((total, section) => {
    return total + section.subsections.reduce((sectionTotal, sub) => {
      return sectionTotal + sub.content.split(/\s+/).filter(word => word.length > 0).length;
    }, 0);
  }, 0);
}

/**
 * Parses markdown content into rich JSON structure
 */
async function parseMarkdownToRichJson(
  markdown: string,
  groqApiKey: string,
  domain?: string
): Promise<RichArticleJson> {
  const lines = markdown.split('\n');
  const sections: Section[] = [];
  let title = '';
  let currentSection: Section | null = null;
  let currentSubsection: { title: string; content: string } | null = null;
  let inReferences = false;
  let contentBuffer = '';
  const references: Array<{ number: number; citation: string; url: string }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Main title (# Title)
    if (line.startsWith('# ') && !title) {
      title = line.substring(2).trim();
      continue;
    }

    // Section title (## Title)
    if (line.startsWith('## ')) {
      // Save previous subsection if exists
      if (currentSubsection && contentBuffer.trim()) {
        currentSubsection.content = contentBuffer.trim();
        contentBuffer = '';
      }

      const sectionTitle = line.substring(3).trim();

      // Check if this is the References section
      if (sectionTitle === 'References' || sectionTitle.toLowerCase() === 'references') {
        inReferences = true;
        continue;
      }

      // Save previous section
      if (currentSection) {
        sections.push(currentSection);
      }

      currentSection = {
        heading: sectionTitle,
        subsections: []
      };
      currentSubsection = null;
      continue;
    }

    // Subsection title (### Title)
    if (line.startsWith('### ')) {
      // Save previous subsection if exists
      if (currentSubsection && contentBuffer.trim()) {
        currentSubsection.content = contentBuffer.trim();
        contentBuffer = '';
      }

      currentSubsection = {
        title: line.substring(4).trim(),
        content: ''
      };

      if (currentSection) {
        currentSection.subsections.push(currentSubsection);
      }
      continue;
    }

    // Parse references
    if (inReferences) {
      // Match pattern: 1. Citation text - [URL](URL)
      const refMatch = line.match(/^(\d+)\.\s+(.+?)\s+-\s+\[([^\]]+)\]\(([^)]+)\)/);
      if (refMatch) {
        references.push({
          number: parseInt(refMatch[1]),
          citation: refMatch[2].trim(),
          url: refMatch[4].trim()
        });
      }
      continue;
    }

    // Skip empty lines at the start of content
    if (!contentBuffer && !line.trim()) {
      continue;
    }

    // Accumulate content for current subsection
    if (currentSubsection && line.trim()) {
      if (contentBuffer) {
        contentBuffer += ' ';
      }
      contentBuffer += line.trim();
    }
  }

  // Save last subsection
  if (currentSubsection && contentBuffer.trim()) {
    currentSubsection.content = contentBuffer.trim();
  }

  // Save last section
  if (currentSection) {
    sections.push(currentSection);
  }

  // Generate summary and key points using AI
  const summary = await generateSummary(sections, title, groqApiKey, domain);

  const wordCount = countWords(sections);
  const sectionCount = sections.length;

  return {
    title,
    summary,
    sections,
    references,
    metadata: {
      word_count: wordCount,
      section_count: sectionCount
    }
  };
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false
        }
      }
    );

    const { task_id, content_plan_outline_guid, markdown } = await req.json();

    // Get Groq API key
    const groqApiKey = Deno.env.get('GROQ_API_KEY') || '';
    if (!groqApiKey) {
      console.warn('GROQ_API_KEY not set, AI-generated summaries will use fallback');
    }

    let markdownContent: string;
    let domain: string | undefined;

    // If markdown is provided directly, use it
    if (markdown) {
      markdownContent = markdown;
    } else {
      // Validate that at least one identifier is provided
      if (!task_id && !content_plan_outline_guid) {
        return new Response(
          JSON.stringify({
            error: 'Either task_id or content_plan_outline_guid must be provided, or markdown must be provided directly'
          }),
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        );
      }

      // Update status: starting conversion
      await updateTaskStatus(supabaseClient, task_id, content_plan_outline_guid, 'converting_markdown_to_json');

      // Fetch the edited_content and client_domain from tasks table
      let query = supabaseClient
        .from('tasks')
        .select('edited_content, client_domain');

      if (task_id) {
        query = query.eq('task_id', task_id);
      } else if (content_plan_outline_guid) {
        query = query.eq('content_plan_outline_guid', content_plan_outline_guid);
      }

      const { data: taskData, error: fetchError } = await query.single();

      if (fetchError) {
        console.error('Error fetching task:', fetchError);
        return new Response(
          JSON.stringify({
            error: 'Task not found',
            details: fetchError.message
          }),
          {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        );
      }

      // Update status: fetching markdown
      await updateTaskStatus(supabaseClient, task_id, content_plan_outline_guid, 'fetching_markdown');

      // Check if edited_content exists
      if (!taskData.edited_content) {
        return new Response(
          JSON.stringify({
            error: 'edited_content is null or empty for this task'
          }),
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        );
      }

      markdownContent = taskData.edited_content;
      domain = taskData.client_domain;
    }

    // Update status: parsing markdown
    await updateTaskStatus(
      supabaseClient,
      task_id || null,
      content_plan_outline_guid || null,
      'parsing_markdown'
    );

    // Update status: generating summary with AI
    await updateTaskStatus(
      supabaseClient,
      task_id || null,
      content_plan_outline_guid || null,
      'generating_summary'
    );

    // Parse the markdown to rich JSON using AI for summary and key points
    const richJson = await parseMarkdownToRichJson(markdownContent, groqApiKey, domain);

    // Update status: saving JSON
    await updateTaskStatus(
      supabaseClient,
      task_id || null,
      content_plan_outline_guid || null,
      'saving_json'
    );

    // Save to tasks table if task_id was provided
    if (task_id || content_plan_outline_guid) {
      const updateData: any = { post_json: richJson };
      
      const { error: updateError } = await supabaseClient
        .from('tasks')
        .update(updateData)
        .eq(task_id ? 'task_id' : 'content_plan_outline_guid', task_id || content_plan_outline_guid);

      if (updateError) {
        console.error('Error updating task:', updateError);
        return new Response(
          JSON.stringify({
            error: 'Failed to save JSON to task',
            details: updateError.message
          }),
          {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        );
      }
    }

    // Update status: conversion complete
    await updateTaskStatus(
      supabaseClient,
      task_id || null,
      content_plan_outline_guid || null,
      'json_conversion_complete'
    );

    return new Response(JSON.stringify(richJson), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error in markdown-to-rich-json function:', error);
    return new Response(
      JSON.stringify({
        error: error.message || 'Internal server error'
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
