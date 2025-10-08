// supabase/functions/generate-meta-description/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { Groq } from 'npm:groq-sdk'

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
    
    console.log(`Processing meta description generation for task ${task_id}`)
    
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
      .select('task_id, title, content, seo_keyword, client_domain')
      .eq('task_id', task_id)
      .single()
    
    if (fetchError || !task) {
      console.error("Error fetching task:", fetchError)
      return new Response(
        JSON.stringify({ error: `Failed to fetch task: ${fetchError?.message || 'Task not found'}` }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    
    // Extract the relevant content from HTML
    console.log("Extracting content from HTML...")
    const content = extractContentFromHTML(task.content)
    
    // Initialize Groq client
    console.log("Generating meta description with AI...")
    const groq = new Groq({
      apiKey: Deno.env.get('GROQ_API_KEY'),
    })
    
    // Construct the prompt for meta description generation
    const prompt = `
You are an SEO expert specializing in creating effective meta descriptions. Your task is to create a concise, compelling meta description for an article.

Here's the article information:
Title: ${task.title}
Primary Keyword: ${task.seo_keyword}
Website Domain: ${task.client_domain}

Here's a brief extract of the article content:
${content.substring(0, 1500)}...

Please create a meta description that:
1. Is between 150-160 characters long (absolute maximum 160 characters)
2. Includes the primary keyword naturally
3. Accurately describes the content of the article
4. Uses active voice and action-oriented language
5. Creates curiosity or provides value to encourage clicks
6. Avoids clickbait or misleading content

Your response should ONLY include the meta description text, with no explanations, quotation marks, or other formatting.
`
    
    // Call the Groq API for meta description generation with reasoning
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: "You are an SEO expert specializing in creating effective meta descriptions."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      model: "openai/gpt-oss-120b",
      temperature: 0.6,
      max_completion_tokens: 200,
      top_p: 0.95,
      reasoning_effort: "medium",
      include_reasoning: true
    })
    
    const metaDescription = chatCompletion.choices[0]?.message?.content?.trim() || ""
    const reasoning = chatCompletion.choices[0]?.message?.reasoning || ""
    
    console.log(`Generated meta description: ${metaDescription}`)
    if (reasoning) {
      console.log(`Reasoning (${reasoning.length} chars): ${reasoning.substring(0, 200)}...`)
    }
    
    // Update the task record with the meta description
    console.log("Updating task record with meta description...")
    
    const { error: updateError } = await supabaseClient
      .from('tasks')
      .update({ meta_description: metaDescription })
      .eq('task_id', task_id)
    
    if (updateError) {
      console.error("Error updating task:", updateError)
      throw updateError
    }
    
    console.log(`Successfully updated meta description for task ${task_id}`)
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Meta description generated and saved successfully",
        meta_description: metaDescription,
        reasoning: reasoning,
        reasoningLength: reasoning.length
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error("Error in meta description generation process:", error)
    
    return new Response(
      JSON.stringify({ error: `Meta description generation failed: ${error.message}` }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

// Helper function to extract text content from HTML
function extractContentFromHTML(html: string): string {
  if (!html) return "";
  
  try {
    // Simple regex-based extraction - remove HTML tags and keep text
    // For production, a proper HTML parser would be better
    let text = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
                   .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
                   .replace(/<[^>]*>/g, " ")
                   .replace(/\s+/g, " ")
                   .trim();
    
    // Additional cleaning as needed
    return text;
  } catch (error) {
    console.error("Error extracting content from HTML:", error)
    return html; // Return raw HTML in case of error
  }
}