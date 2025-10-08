import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import OpenAI from 'https://esm.sh/openai@4.12.4'

serve(async (req) => {
  // Parse the request body
  const { content_plan_id } = await req.json()
  
  console.log(`Processing content plan with ID: ${content_plan_id}`)
  
  if (!content_plan_id) {
    return new Response(
      JSON.stringify({ error: "content_plan_id is required" }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    )
  }
  
  try {
    // Initialize Supabase client with service role key for admin rights
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    )
    
    // Step 1: Fetch the content_plan_table data
    console.log("Fetching content plan table markdown...")
    const { data: contentPlan, error: fetchError } = await supabaseClient
      .from('content_plans')
      .select('content_plan_table')
      .eq('guid', content_plan_id)
      .single()
    
    if (fetchError || !contentPlan) {
      throw new Error(`Failed to fetch content plan: ${fetchError?.message || 'Content plan not found'}`)
    }
    
    const markdownTable = contentPlan.content_plan_table
    
    if (!markdownTable) {
      throw new Error('Content plan table is empty')
    }
    
    // Step 2: Process with OpenAI
    console.log("Processing markdown with OpenAI...")
    const openai = new OpenAI({
      apiKey: Deno.env.get('OPENAI_API_KEY') || '',
    })

    const prompt = `I have the following <markdown>${markdownTable}</markdown> I need you to convert it to json like this <json>[{"Hub Number": "1", "Spoke Number": "1", "Post Title": "Sample Title", "Keyword": "sample keyword", "URL Slug": "/sample-slug", "CPC": "$0.03", "Difficulty": "4", "Volume": "150", "guid": null}]</json> wrap your answer in <answer> give me nothing but the json`
    
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: prompt
        }
      ],
    })
    
    const assistantResponse = response.choices[0]?.message?.content || ''
    
    // Extract JSON from <answer> tags
    let jsonContent = ''
    const answerMatch = assistantResponse.match(/<answer>(.*?)<\/answer>/s)
    
    if (answerMatch && answerMatch[1]) {
      jsonContent = answerMatch[1].trim()
    } else {
      throw new Error('Failed to extract JSON from OpenAI response')
    }
    
    // Validate that the response is valid JSON
    let parsedJson
    try {
      parsedJson = JSON.parse(jsonContent)
    } catch (err) {
      throw new Error(`Invalid JSON returned from OpenAI: ${err.message}`)
    }
    
    // Step 3: Update the content_plan field
    console.log("Updating content plan with processed JSON...")
    const { error: updateError } = await supabaseClient
      .from('content_plans')
      .update({ content_plan: jsonContent })
      .eq('guid', content_plan_id)
    
    if (updateError) {
      throw new Error(`Failed to update content plan: ${updateError.message}`)
    }
    
    // Step 4: Insert individual items into content_plan_items table
    console.log("Inserting items into content_plan_items table...")
    
    // First, delete any existing items for this content plan
    const { error: deleteError } = await supabaseClient
      .from('content_plan_items')
      .delete()
      .eq('content_plan_id', content_plan_id)
    
    if (deleteError) {
      console.warn(`Warning: Failed to delete existing items: ${deleteError.message}`)
    }
    
    // Then insert all the new items
    let insertErrors = []
    for (const item of parsedJson) {
      const { error: insertError } = await supabaseClient
        .from('content_plan_items')
        .insert({
          content_plan_id: content_plan_id,
          hub_number: item['Hub Number'] ? parseInt(item['Hub Number']) : null,
          spoke_number: item['Spoke Number'] ? parseInt(item['Spoke Number']) : null,
          post_title: item['Post Title'],
          keyword: item['Keyword'],
          url_slug: item['URL Slug'],
          cpc: item['CPC'],
          difficulty: item['Difficulty'] ? parseInt(item['Difficulty']) : null,
          volume: item['Volume'] ? parseInt(item['Volume']) : null
        })
      
      if (insertError) {
        insertErrors.push({ item: item['Post Title'], error: insertError.message })
      }
    }
    
    // Log any insertion errors that occurred
    if (insertErrors.length > 0) {
      console.warn(`Warning: Failed to insert ${insertErrors.length} items:`, insertErrors)
    }
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Content plan successfully processed and updated',
        itemsProcessed: parsedJson.length,
        itemsInsertErrors: insertErrors.length
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
    
  } catch (error) {
    console.error('Error processing content plan:', error)
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message 
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}) 