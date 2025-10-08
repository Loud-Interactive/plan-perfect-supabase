// supabase/functions/generate-factcheck/index.ts
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
    
    console.log(`Processing fact check for task ${task_id}`)
    
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
      .select('task_id, title, content, client_name, client_domain, seo_keyword')
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
    console.log("Generating fact check with AI...")
    const groq = new Groq({
      apiKey: Deno.env.get('GROQ_API_KEY'),
    })
    
    // Construct the prompt for fact checking
    const prompt = `
You are an expert fact checker for online content. I'm going to provide you with an article, and I need you to:

1. Identify factual claims that could be verified
2. Evaluate the accuracy of these claims based on your knowledge
3. Score each claim on a scale of 1-5 where:
   - 1: Likely false
   - 2: Questionable
   - 3: Partially accurate with caveats
   - 4: Mostly accurate
   - 5: Completely accurate

4. For any claims that score 3 or lower, explain why and suggest corrections
5. Provide an overall factual accuracy assessment of the article

Here's the article:
Title: ${task.title}
Keyword: ${task.seo_keyword}
Domain: ${task.client_domain}

${content}

Format your response as structured JSON with the following fields:
{
  "overall_assessment": "A brief summary of the article's factual accuracy",
  "overall_score": 5, // 1-5 scale
  "claims": [
    {
      "claim": "The exact claim from the text",
      "context": "The surrounding context of the claim",
      "score": 5, // 1-5 scale
      "explanation": "Why this score was given",
      "suggested_correction": "Suggested correction if score <= 3, otherwise null"
    }
  ],
  "recommendations": [
    "List of recommendations to improve factual accuracy"
  ]
}
`
    
    // Call the Groq API for fact checking with reasoning
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: "You are an expert fact checker for online content, specializing in verifying factual claims."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      model: "openai/gpt-oss-120b",
      temperature: 0.6,
      max_completion_tokens: 4000,
      top_p: 0.95,
      reasoning_effort: "high", // Use high reasoning for fact checking
      include_reasoning: true
    })
    
    const factCheckResult = chatCompletion.choices[0]?.message?.content || ""
    const reasoning = chatCompletion.choices[0]?.message?.reasoning || ""
    
    console.log(`Generated fact check, length: ${factCheckResult.length}`)
    if (reasoning) {
      console.log(`Reasoning (${reasoning.length} chars): ${reasoning.substring(0, 200)}...`)
    }
    
    // Generate a UUID for the fact check
    const factcheckGuid = self.crypto.randomUUID()
    
    // Update the task record with the fact check results
    console.log("Updating task record with fact check results...")
    
    const { error: updateError } = await supabaseClient
      .from('tasks')
      .update({ 
        factcheck_guid: factcheckGuid,
        factcheck_status: 'Complete',
        // Store fact check data in a separate table or column as needed
      })
      .eq('task_id', task_id)
    
    if (updateError) {
      console.error("Error updating task:", updateError)
      throw updateError
    }
    
    // Store the fact check result in a separate table
    const { error: insertError } = await supabaseClient
      .from('factchecks')
      .insert({
        factcheck_guid: factcheckGuid,
        task_id: task_id,
        factcheck_data: factCheckResult,
        created_at: new Date().toISOString()
      })
    
    if (insertError) {
      console.error("Error inserting fact check:", insertError)
      throw insertError
    }
    
    console.log(`Successfully completed fact check for task ${task_id}`)
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Fact check generated and saved successfully",
        factcheck_guid: factcheckGuid,
        reasoning: reasoning,
        reasoningLength: reasoning.length
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error("Error in fact check process:", error)
    
    return new Response(
      JSON.stringify({ error: `Fact check generation failed: ${error.message}` }),
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