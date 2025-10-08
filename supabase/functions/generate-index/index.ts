// supabase/functions/generate-index/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  // Set CORS headers for all responses
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  }

  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders, status: 204 })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  
  try {
    // Parse the request body
    const { task_id } = await req.json()
    
    console.log(`Processing index generation for task ${task_id}`)
    
    if (!task_id) {
      return new Response(
        JSON.stringify({ error: "task_id is required" }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    
    // Initialize Supabase client with service role key for admin rights
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    )
    
    // Fetch the task data
    console.log("Fetching task data...")
    const { data: task, error: fetchError } = await supabaseClient
      .from('tasks')
      .select('task_id, title, content')
      .eq('task_id', task_id)
      .single()
    
    if (fetchError || !task) {
      console.error("Error fetching task:", fetchError)
      return new Response(
        JSON.stringify({ error: `Failed to fetch task: ${fetchError?.message || 'Task not found'}` }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    
    // Parse the HTML content to extract headings
    console.log("Extracting headings from HTML content...")
    const { headings, indexHtml } = extractHeadingsFromHTML(task.content)
    
    if (headings.length === 0) {
      console.log("No headings found in content")
      return new Response(
        JSON.stringify({ error: "No headings found in content" }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    
    // Generate a UUID for the index
    const indexGuid = self.crypto.randomUUID()
    
    // Update the task record with the index
    console.log("Updating task record with index...")
    
    const { error: updateError } = await supabaseClient
      .from('tasks')
      .update({ 
        index_guid: indexGuid,
        index_status: 'Complete'
        // If you want to update the content with the added IDs, use:
        // content: indexHtml
      })
      .eq('task_id', task_id)
    
    if (updateError) {
      console.error("Error updating task:", updateError)
      throw updateError
    }
    
    // Store the index in a separate table
    const { error: insertError } = await supabaseClient
      .from('indices')
      .insert({
        index_guid: indexGuid,
        task_id: task_id,
        index_data: JSON.stringify(headings),
        index_html: generateTableOfContentsHTML(headings),
        created_at: new Date().toISOString()
      })
    
    if (insertError) {
      console.error("Error inserting index:", insertError)
      throw insertError
    }
    
    console.log(`Successfully generated index for task ${task_id}`)
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Index generated and saved successfully",
        index_guid: indexGuid,
        headings: headings,
        toc_html: generateTableOfContentsHTML(headings)
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error("Error in index generation process:", error)
    
    return new Response(
      JSON.stringify({ error: `Index generation failed: ${error.message}` }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

// Type definition for heading
interface Heading {
  id: string;
  text: string;
  level: number;
  parentId?: string;
  children?: Heading[];
}

// Helper function to extract headings from HTML
function extractHeadingsFromHTML(html: string): { headings: Heading[]; indexHtml: string } {
  if (!html) return { headings: [], indexHtml: html };
  
  try {
    const headings: Heading[] = [];
    
    // Regular expression to match heading tags (h1-h6)
    const headingRegex = /<h([1-6])[^>]*>(.*?)<\/h\1>/gi;
    
    // Replace headings with IDs if they don't have one already
    let indexHtml = html;
    let match;
    let idCounter = 1;
    
    while ((match = headingRegex.exec(html)) !== null) {
      const levelStr = match[1];
      const level = parseInt(levelStr);
      let headingText = match[2].replace(/<.*?>/g, '').trim(); // Remove any HTML tags inside the heading
      
      // Check if heading already has an ID
      const idMatch = match[0].match(/id=["']([^"']*)["']/i);
      let id;
      
      if (idMatch && idMatch[1]) {
        id = idMatch[1];
      } else {
        // Generate a slug from the heading text
        id = `heading-${idCounter++}`;
        
        // Replace the heading with one that has an ID
        const originalHeading = match[0];
        const newHeading = `<h${level} id="${id}">${match[2]}</h${level}>`;
        indexHtml = indexHtml.replace(originalHeading, newHeading);
      }
      
      headings.push({
        id,
        text: headingText,
        level
      });
    }
    
    // Build hierarchy
    const hierarchy = buildHeadingHierarchy(headings);
    
    return { headings: hierarchy, indexHtml };
  } catch (error) {
    console.error("Error extracting headings:", error);
    return { headings: [], indexHtml: html };
  }
}

// Build heading hierarchy
function buildHeadingHierarchy(headings: Heading[]): Heading[] {
  if (headings.length === 0) return [];
  
  const result: Heading[] = [];
  const stack: Heading[] = [];
  
  headings.forEach(heading => {
    // Pop stack until we find a heading with a lower level (higher in hierarchy)
    while (stack.length > 0 && stack[stack.length - 1].level >= heading.level) {
      stack.pop();
    }
    
    if (stack.length > 0) {
      // This heading has a parent
      const parent = stack[stack.length - 1];
      heading.parentId = parent.id;
      
      if (!parent.children) {
        parent.children = [];
      }
      parent.children.push(heading);
    } else {
      // This is a top-level heading
      result.push(heading);
    }
    
    stack.push(heading);
  });
  
  return result;
}

// Generate Table of Contents HTML
function generateTableOfContentsHTML(headings: Heading[]): string {
  const generateListItems = (items: Heading[]): string => {
    if (!items || items.length === 0) return '';
    
    let html = '<ul>';
    items.forEach(item => {
      html += `<li><a href="#${item.id}">${item.text}</a>`;
      if (item.children && item.children.length > 0) {
        html += generateListItems(item.children);
      }
      html += '</li>';
    });
    html += '</ul>';
    
    return html;
  };
  
  return `
    <div class="table-of-contents">
      <h2>Table of Contents</h2>
      ${generateListItems(headings)}
    </div>
  `;
}