import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
};
/**
 * Parses markdown content and converts it to structured JSON format
 */ function parseMarkdownToJson(markdown) {
  const lines = markdown.split('\n');
  const result = {
    title: '',
    sections: [],
    references: []
  };
  let currentSection = null;
  let currentSubsection = null;
  let inReferences = false;
  let contentBuffer = '';
  for(let i = 0; i < lines.length; i++){
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
      if (sectionTitle === 'References') {
        inReferences = true;
        continue;
      }
      // Save previous section
      if (currentSection) {
        result.sections.push(currentSection);
      }
      currentSection = {
        title: sectionTitle,
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
        result.references.push({
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
    result.sections.push(currentSection);
  }
  return result;
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
    const { task_id, content_plan_outline_guid } = await req.json();
    // Validate that at least one identifier is provided
    if (!task_id && !content_plan_outline_guid) {
      return new Response(JSON.stringify({
        error: 'Either task_id or content_plan_outline_guid must be provided'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Fetch the edited_content from tasks table
    let query = supabaseClient.from('tasks').select('edited_content, title');
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
    // Check if edited_content exists
    if (!taskData.edited_content) {
      return new Response(JSON.stringify({
        error: 'edited_content is null or empty for this task'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Parse the markdown to JSON
    const jsonOutput = parseMarkdownToJson(taskData.edited_content);
    return new Response(JSON.stringify(jsonOutput), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Error in markdown-to-json function:', error);
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
