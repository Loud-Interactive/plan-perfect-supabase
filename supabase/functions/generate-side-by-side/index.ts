// Supabase Edge Function: generate-side-by-side
// Generates complete HTML blog posts from outlines with AI-enhanced callouts
// Combines markdown generation, JSON conversion, HTML construction, and Groq-based enhancements

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Anthropic from 'https://esm.sh/@anthropic-ai/sdk@0.21.0';
import { Groq } from 'npm:groq-sdk';

// Import utilities
import { corsHeaders } from '../helpers/index.ts';
import { PostContentJSON, OutlineData } from '../utils/html-generation/types.ts';
import { loadCompletePreferences } from '../utils/html-generation/preferences-loader.ts';
import { generateCallouts, generateEnhancedSummary } from '../utils/html-generation/callout-generator.ts';
import { constructHTML } from '../utils/html-generation/html-constructor.ts';
import { generateSchema } from '../utils/html-generation/schema-generator.ts';

// Initialize environment variables
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || '';
const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY') || '';

/**
 * Fetch outline data and related information from Supabase
 */
async function fetchOutlineData(
  supabase: any,
  outline_guid: string
): Promise<OutlineData> {
  console.log('[FetchOutline] Fetching outline data for guid:', outline_guid);

  // Fetch outline from content_plan_outlines
  const { data: outlineData, error: outlineError } = await supabase
    .from('content_plan_outlines')
    .select('*')
    .eq('guid', outline_guid)
    .single();

  if (outlineError) {
    throw new Error(`Failed to fetch outline: ${outlineError.message}`);
  }

  if (!outlineData) {
    throw new Error('Outline not found');
  }

  console.log('[FetchOutline] Outline found for domain:', outlineData.domain);

  // Fetch content plan data if available
  let contentPlanData = null;
  if (outlineData.content_plan_id) {
    const { data: contentPlan } = await supabase
      .from('content_plans')
      .select('domain_name, client_name, brand_voice, entity_voice, writing_language, target_keyword, seo_keyword, synopsis_and_cta')
      .eq('id', outlineData.content_plan_id)
      .single();

    if (contentPlan) {
      contentPlanData = contentPlan;
      console.log('[FetchOutline] Content plan data found');
    }
  }

  // Fetch synopsis data if available
  let synopsisData = null;
  if (outlineData.synopsis_id) {
    const { data: synopsis } = await supabase
      .from('synopsis')
      .select('voice_prompt, voice_traits, tone, first_person_voice, second_person_voice, third_person_voice, brand_personality, preferred_language')
      .eq('id', outlineData.synopsis_id)
      .single();

    if (synopsis) {
      synopsisData = synopsis;
      console.log('[FetchOutline] Synopsis data found');
    }
  }

  // Fetch pairs data for client info
  let pairsData: any = null;
  if (outlineData.domain) {
    const { data: pairs } = await supabase
      .from('pairs')
      .select('key, value')
      .eq('domain', outlineData.domain)
      .in('key', ['domain_name', 'client_name']);

    if (pairs && pairs.length > 0) {
      pairsData = pairs.reduce((acc: any, pair: any) => {
        if (pair.key === 'domain_name') acc.domain_name = pair.value;
        if (pair.key === 'client_name') acc.client_name = pair.value;
        return acc;
      }, {});
      console.log('[FetchOutline] Pairs data found');
    }
  }

  // Parse outline sections
  // CRITICAL FIX: The column is called 'outline', not 'outline_sections'
  // And it contains a JSON object with a 'sections' property inside
  let outlineSections = [];
  if (outlineData.outline) {
    const outlineJson = typeof outlineData.outline === 'string'
      ? JSON.parse(outlineData.outline)
      : outlineData.outline;

    // Extract sections from the nested structure
    outlineSections = outlineJson.sections || [];
    console.log(`[FetchOutline] Loaded ${outlineSections.length} sections from outline`);
  } else {
    console.warn('[FetchOutline] No outline data found, using fallback structure');
    outlineSections = [{
      title: outlineData.post_title || 'Untitled Section',
      subheadings: ['Introduction', 'Main Content', 'Conclusion']
    }];
  }

  return {
    outline: { sections: outlineSections },
    content_plan_id: outlineData.content_plan_id || null, // Pass through for task creation
    client_name: contentPlanData?.client_name || pairsData?.client_name || 'Default Client',
    client_domain: contentPlanData?.domain_name || pairsData?.domain_name || outlineData.domain || 'example.com',
    brand_voice: synopsisData?.voice_prompt || synopsisData?.voice_traits || synopsisData?.tone || contentPlanData?.brand_voice,
    entity_voice: synopsisData?.first_person_voice || synopsisData?.second_person_voice || synopsisData?.third_person_voice || contentPlanData?.entity_voice,
    writing_language: synopsisData?.preferred_language || contentPlanData?.writing_language || 'English',
    target_keyword: contentPlanData?.target_keyword || outlineData.post_keyword,
    seo_keyword: contentPlanData?.seo_keyword || outlineData.post_keyword,
    synopsis_and_cta: contentPlanData?.synopsis_and_cta
  };
}

/**
 * Build prompt for markdown generation
 */
function buildMarkupPrompt(outlineData: OutlineData): string {
  const { outline, client_name, client_domain, brand_voice, entity_voice, writing_language, target_keyword, seo_keyword, synopsis_and_cta } = outlineData;

  // Count sections and subsections
  const sectionCount = outline.sections.length;
  let subsectionCount = 0;
  outline.sections.forEach((section: any) => {
    subsectionCount += (section.subheadings?.length || 0);
  });

  // Build the outline content string
  let outlineContent = "";
  outline.sections.forEach((section: any, index: number) => {
    outlineContent += `## ${section.title}\n`;
    if (section.subheadings && section.subheadings.length > 0) {
      section.subheadings.forEach((subheading: any) => {
        outlineContent += `### ${subheading}\n`;
      });
    }
    if (index < outline.sections.length - 1) outlineContent += "\n";
  });

  return `🚨 CRITICAL TASK: Convert this outline into markdown with EXACT structure preservation.

**MANDATORY STRUCTURE REQUIREMENTS:**
- The outline below contains ${sectionCount} sections (## headings) and ${subsectionCount} subsections (### headings)
- Your output MUST contain EXACTLY ${sectionCount} ## headings
- Your output MUST contain EXACTLY ${subsectionCount} ### headings
- Every heading MUST match the exact text from the outline
- Do NOT create your own section structure
- Do NOT simplify, consolidate, or modify the outline structure
- Do NOT use generic section names like "Introduction", "Main Content", "Conclusion" unless they appear in the outline below

**FORBIDDEN BEHAVIORS:**
❌ Creating your own section/subsection structure
❌ Simplifying 7 sections into 3 sections
❌ Using generic names instead of the provided headings
❌ Skipping any sections or subsections
❌ Reordering sections
❌ Combining multiple subsections into one

**REQUIRED OUTPUT STRUCTURE:**
Your markdown output MUST follow this EXACT template (with content added after each heading):

${outline.sections.map((section: any, i: number) => {
  let template = `## ${section.title}\n`;
  if (section.subheadings && section.subheadings.length > 0) {
    section.subheadings.forEach((subheading: any) => {
      template += `### ${subheading}\n[Write 2-3 paragraphs of content here]\n\n`;
    });
  }
  return template;
}).join('\n')}

**CONTENT GENERATION RULES:**
1. For EACH ### heading, write 2-3 full paragraphs (3-5 sentences each)
2. Write in flowing, narrative paragraphs - NO bullet points or lists
3. Include specific examples, statistics, and actionable advice
4. Use transitional sentences between paragraphs
5. Maintain professional, informative tone
6. Include 3-5 reference citations [1], [2], [3] at the end of relevant sentences

**BRAND VOICE:**
${brand_voice ? `- Brand Voice: ${brand_voice}` : ''}
${entity_voice ? `- Entity Voice: ${entity_voice}` : ''}
${writing_language ? `- Writing Language: ${writing_language}` : ''}

**SEO:**
${target_keyword ? `- Target Keyword: ${target_keyword}` : ''}
${seo_keyword ? `- SEO Keyword: ${seo_keyword}` : ''}

**CLIENT:**
- Write in the voice of ${client_name} (${client_domain})
${synopsis_and_cta ? `- Additional Context: ${synopsis_and_cta}` : ''}

**THE OUTLINE (FOLLOW THIS EXACT STRUCTURE):**
${outlineContent}

🚨 REMINDER: Your output must have exactly ${sectionCount} ## headings and ${subsectionCount} ### headings matching the outline above. Add content after each heading, but do NOT change the heading structure.`;
}

/**
 * Generate markdown content from outline using Claude
 */
async function generateMarkdown(outlineData: OutlineData): Promise<string> {
  console.log('[GenerateMarkdown] Starting markdown generation...');

  if (!ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY environment variable is not set');
  }

  const anthropic = new Anthropic({
    apiKey: ANTHROPIC_API_KEY,
  });

  const prompt = buildMarkupPrompt(outlineData);

  console.log('[GenerateMarkdown] Prompt first 1000 chars:', prompt.substring(0, 1000));
  console.log('[GenerateMarkdown] Prompt last 500 chars:', prompt.substring(prompt.length - 500));
  console.log('[GenerateMarkdown] Total prompt length:', prompt.length);
  console.log('[GenerateMarkdown] Calling Claude API...');

  const response = await anthropic.messages.create({
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 8192,  // Maximum for Claude 3.5 Sonnet - handles larger outlines
    messages: [{ role: "user", content: prompt }]
  });

  if (!response.content?.[0]?.text) {
    throw new Error("Invalid response from Claude API - no text content found");
  }

  const markdown = response.content[0].text;

  console.log(`[GenerateMarkdown] Generated ${markdown.length} characters of markdown`);

  return markdown;
}

/**
 * Parse markdown to JSON deterministically (NO AI - preserves citations naturally!)
 * Based on supabase/functions/markdown-to-json/index.ts
 */
function parseMarkdownToJson(markdown: string): PostContentJSON {
  console.log('[ParseMarkdown] Using deterministic parser (preserves citations naturally)...');

  const lines = markdown.split('\n');
  const result: PostContentJSON = {
    title: '',
    summary: { content: '' },
    sections: [],
    key_takeaways: {
      description: 'Key points from this article',
      items: []
    },
    references: []
  };

  let currentSection: any = null;
  let currentSubsection: any = null;
  let inReferences = false;
  let contentBuffer = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Main title (# Title)
    if (line.startsWith('# ') && !result.title) {
      result.title = line.substring(2).trim();
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
        result.sections.push(currentSection);
      }

      currentSection = {
        heading: sectionTitle,
        subsections: [],
        content_type: 'section'
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
        heading: line.substring(4).trim(),
        content: '',
        content_type: 'paragraph'
      };

      if (currentSection) {
        currentSection.subsections.push(currentSubsection);
      }
      continue;
    }

    // Parse references
    if (inReferences) {
      // Match pattern: 1. Citation text - [URL](URL) or just numbered list
      const refMatch = line.match(/^(\d+)\.\s+(.+)/);
      if (refMatch) {
        const refNum = parseInt(refMatch[1]);
        const refText = refMatch[2].trim();

        // Try to extract URL from markdown link
        const urlMatch = refText.match(/\[([^\]]+)\]\(([^)]+)\)/);

        result.references.push({
          url: urlMatch ? urlMatch[2] : '#',
          citation: urlMatch ? refText.replace(/\[([^\]]+)\]\(([^)]+)\)/, '$1') : refText
        });
      }
      continue;
    }

    // Skip empty lines at the start of content
    if (!contentBuffer && !line.trim()) {
      continue;
    }

    // Accumulate content for current subsection
    // KEY: This preserves [N] citations naturally since we just concatenate lines!
    if (currentSubsection && line.trim()) {
      if (contentBuffer) {
        contentBuffer += ' ';
      }
      contentBuffer += line.trim();  // [N] citations are preserved here!
    }
  }

  // Save last subsection
  if (currentSubsection && contentBuffer.trim()) {
    currentSubsection.content = contentBuffer.trim();
  }

  // Save last section
  if (currentSection) {
    result.sections.push(currentSection);
  }

  // Extract references from citation numbers if no References section was found
  if (result.references.length === 0) {
    const allRefs = new Set<number>();
    const refPattern = /\[(\d+)\]/g;
    let match;
    while ((match = refPattern.exec(markdown)) !== null) {
      allRefs.add(parseInt(match[1]));
    }

    if (allRefs.size > 0) {
      const maxRef = Math.max(...Array.from(allRefs));
      result.references = Array.from({ length: maxRef }, (_, i) => ({
        url: "#",
        citation: `Reference ${i + 1}`
      }));
    }
  }

  // Count preserved citations
  const markdownRefs = (markdown.match(/\[\d+\]/g) || []).length;
  const jsonRefs = (JSON.stringify(result).match(/\[\d+\]/g) || []).length;
  console.log(`[ParseMarkdown] ✅ Preserved ${jsonRefs}/${markdownRefs} reference citations naturally!`);

  return result;
}

/**
 * Convert markdown to structured JSON (deterministic parser - NO AI!)
 */
async function markdownToJson(markdown: string, outlineData: OutlineData): Promise<PostContentJSON> {
  console.log('[MarkdownToJson] Using deterministic parser (no AI, preserves citations)...');

  const json = parseMarkdownToJson(markdown);

  console.log('[MarkdownToJson] Parsed successfully with citations preserved');
  return json;
}

// Main handler
serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  let taskId: string | undefined;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    console.log('🚀 [Main] generate-side-by-side edge function called');

    // Parse request
    const body = await req.json();
    const { outline_guid, task_id } = body;

    if (!outline_guid) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing required field: outline_guid' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    console.log('[Main] Outline GUID:', outline_guid);
    console.log('[Main] Task ID:', task_id || 'none');

    // Step 1: Fetch outline data FIRST (before creating task)
    const outlineData = await fetchOutlineData(supabase, outline_guid);
    console.log('[Main] Fetched outline for:', outlineData.client_name);

    // Extract post title from outline
    const postTitle = outlineData.outline.sections?.[0]?.title ||
                      outlineData.target_keyword ||
                      'Blog Post';

    // CRITICAL: Always try to find existing task by content_plan_outline_guid FIRST
    // This prevents creating duplicate tasks and preserves existing metadata
    taskId = task_id; // Start with provided task_id if any

    if (!taskId) {
      console.log('[Main] No task_id provided, searching for existing task by content_plan_outline_guid...');

      // Look for existing task with this outline_guid
      const { data: existingTasks, error: findError } = await supabase
        .from('tasks')
        .select('task_id, status, title, created_at')
        .eq('content_plan_outline_guid', outline_guid)
        .order('created_at', { ascending: false })
        .limit(5);

      if (findError) {
        console.warn('[Main] Error searching for existing task:', findError.message);
      }

      if (existingTasks && existingTasks.length > 0) {
        // Use the most recent task
        taskId = existingTasks[0].task_id;
        console.log(`[Main] Found ${existingTasks.length} existing task(s), using most recent:`, taskId);
        console.log('[Main] Existing task details:', {
          task_id: existingTasks[0].task_id,
          status: existingTasks[0].status,
          title: existingTasks[0].title,
          created_at: existingTasks[0].created_at
        });
      } else {
        console.log('[Main] No existing task found for this outline_guid');
      }
    }

    // If we still don't have a task_id, create a new task
    if (!taskId) {
      console.log('[Main] Creating new task with all relevant fields populated...');

      const { data: newTask, error: taskError} = await supabase
        .from('tasks')
        .insert({
          status: 'loading_preferences',
          title: postTitle,
          seo_keyword: outlineData.seo_keyword || null,
          content_plan_outline_guid: outline_guid,
          content_plan_guid: outlineData.content_plan_id || null, // Map content_plan_id → content_plan_guid
          client_name: outlineData.client_name || null,
          client_domain: outlineData.client_domain || null
        })
        .select('task_id')
        .single();

      if (taskError) {
        throw new Error(`Failed to create task: ${taskError.message}`);
      }

      taskId = newTask.task_id;
      console.log('[Main] Created new task:', taskId);
    } else {
      // We have an existing task - just update status to begin processing
      console.log('[Main] Using existing task:', taskId, '- updating status to loading_preferences');

      // Only update status, preserve all other existing data
      await supabase.from('tasks').update({
        status: 'loading_preferences',
        updated_at: new Date().toISOString()
      }).eq('task_id', taskId);
    }

    // Step 2: Load preferences
    await supabase.from('tasks').update({ status: 'loading_preferences' }).eq('task_id', taskId);
    const { preferences, calloutPreferences } = await loadCompletePreferences(supabase, outlineData.client_domain);
    console.log('[Main] Loaded preferences for domain:', outlineData.client_domain);

    // Step 3: Check for existing content (CRITICAL: Don't regenerate if it already exists!)
    console.log('[Main] Checking for existing edited_content and post_json...');
    const { data: existingTaskData, error: taskDataError } = await supabase
      .from('tasks')
      .select('edited_content, post_json')
      .eq('task_id', taskId)
      .single();

    let markdown: string;
    let json: PostContentJSON;
    let generatedMarkdown = false;
    let generatedJson = false;

    // Step 3a: Get or generate markdown
    if (existingTaskData?.edited_content) {
      console.log('[Main] ✅ Found existing markdown - using it!');
      console.log('[Main] Markdown length:', existingTaskData.edited_content.length);
      markdown = existingTaskData.edited_content;
    } else {
      console.log('[Main] ⚠️ No existing markdown - generating new markdown');
      await supabase.from('tasks').update({ status: 'generating_markdown' }).eq('task_id', taskId);
      markdown = await generateMarkdown(outlineData);
      generatedMarkdown = true;
      console.log('[Main] Generated new markdown');
    }

    // Step 3b: Get or generate JSON (from existing or newly generated markdown)
    if (existingTaskData?.post_json) {
      console.log('[Main] ✅ Found existing JSON - using it!');
      console.log('[Main] JSON sections:', existingTaskData.post_json?.sections?.length || 0);
      json = typeof existingTaskData.post_json === 'string'
        ? JSON.parse(existingTaskData.post_json)
        : existingTaskData.post_json;
    } else {
      console.log('[Main] ⚠️ No existing JSON - converting markdown to JSON');
      await supabase.from('tasks').update({ status: 'converting_markdown_to_json' }).eq('task_id', taskId);
      json = await markdownToJson(markdown, outlineData);
      generatedJson = true;
      console.log('[Main] Converted markdown to JSON');
    }

    // Step 5: Generate callouts with Groq
    await supabase.from('tasks').update({ status: 'generating_ai_callouts' }).eq('task_id', taskId);
    const calloutResult = await generateCallouts(json, GROQ_API_KEY, outlineData.client_domain);
    console.log('[Main] Generated callouts:', calloutResult.callouts.size);

    // Step 6: Generate enhanced summary with Groq
    await supabase.from('tasks').update({ status: 'generating_ai_summary' }).eq('task_id', taskId);
    const enhancedSummary = await generateEnhancedSummary(json, GROQ_API_KEY, outlineData.client_domain);
    json.summary = { content: enhancedSummary };
    console.log('[Main] Generated enhanced summary');

    // Step 7: Construct HTML with callouts
    await supabase.from('tasks').update({ status: 'constructing_html' }).eq('task_id', taskId);
    const html = await constructHTML(json, preferences, calloutPreferences, calloutResult.callouts);
    console.log('[Main] Constructed HTML:', html.length, 'characters');

    // Step 8: Injecting callouts into HTML
    await supabase.from('tasks').update({ status: 'injecting_callouts' }).eq('task_id', taskId);
    console.log('[Main] Callouts injected into HTML');

    // Step 9: Finalizing HTML
    await supabase.from('tasks').update({ status: 'finalizing_html' }).eq('task_id', taskId);
    console.log('[Main] Finalizing HTML document');

    // Step 10: Generate JSON-LD schema with Groq (SKIPPED to avoid timeout - generate separately)
    console.log('[Main] ⚠️ Skipping schema generation to avoid Edge Function timeout');
    const schemaResult = { success: false, schema: '', reasoning: '', error: 'Skipped to avoid timeout' };

    // Step 11: Saving to database
    await supabase.from('tasks').update({ status: 'saving_to_database' }).eq('task_id', taskId);
    console.log('[Main] Saving generated content to database');

    // Step 12: Update task with generated content
    // IMPORTANT: Only update fields we're responsible for generating
    // DO NOT touch: title, seo_keyword, client_name, client_domain, content_plan_guid,
    //               html_link, google_doc_link, live_post_url, wordpress_post_id, etc.
    // ONLY update: post_html, content, schema_data, status, updated_at
    // CRITICAL: Only update edited_content/post_json if we actually GENERATED them
    const updateData: any = {
      status: 'completed',
      post_html: html,
      content: html,
      updated_at: new Date().toISOString()
    };

    // Only update markdown if we generated it
    if (generatedMarkdown) {
      console.log('[Main] Saving newly generated markdown to database');
      updateData.edited_content = markdown;
    } else {
      console.log('[Main] Preserving existing edited_content');
    }

    // Only update JSON if we generated it
    if (generatedJson) {
      console.log('[Main] Saving newly generated JSON to database');
      updateData.post_json = json;
    } else {
      console.log('[Main] Preserving existing post_json');
    }

    // Add schema_data if generation was successful
    if (schemaResult.success && schemaResult.schema) {
      updateData.schema_data = schemaResult.schema;
      updateData.schema_added_at = new Date().toISOString();
    }

    const { error: updateError } = await supabase.from('tasks').update(updateData).eq('task_id', taskId);

    if (updateError) {
      console.error('[Main] ❌ Database update failed:', updateError);
      throw new Error(`Failed to save to database: ${updateError.message}`);
    }

    console.log('[Main] ✅ Task completed successfully');

    // Return success response
    return new Response(
      JSON.stringify({
        success: true,
        task_id: taskId,
        outline_guid,
        html_length: html.length,
        json_sections: json.sections?.length || 0,
        callouts_generated: calloutResult.callouts.size,
        schema_generated: schemaResult.success,
        schema_length: schemaResult.success ? schemaResult.schema.length : 0
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Main] Error:', error);

    // Update task status to indicate error
    // Only update status, error_message, and updated_at - don't touch other fields
    if (taskId) {
      try {
        await supabase.from('tasks').update({
          status: 'failed',
          message: error.message, // Using 'message' field per schema, not 'error_message'
          updated_at: new Date().toISOString()
        }).eq('task_id', taskId);
      } catch (statusError) {
        console.error('[Main] Failed to update error status:', statusError);
      }
    }

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        task_id: taskId
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
