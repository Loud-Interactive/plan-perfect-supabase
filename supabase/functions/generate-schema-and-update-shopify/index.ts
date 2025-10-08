// Enhanced Schema Generation with Shopify Update
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders, status: 204 })
  }

  try {
    const requestData = await req.json()
    const { 
      task_id, 
      url, 
      content, 
      title, 
      client_domain,
      shopify_article_id,
      shopify_config
    } = requestData

    console.log(`Processing schema generation for task ${task_id}, article ${shopify_article_id}`)

    if (!task_id || !url || !shopify_article_id || !shopify_config) {
      return new Response(
        JSON.stringify({ error: "Missing required parameters" }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    )

    // Step 1: Call the existing generate-schema function
    console.log(`Calling generate-schema function for task ${task_id}`)
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    
    const schemaResponse = await fetch(`${supabaseUrl}/functions/v1/generate-schema`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ task_id, live_post_url: url })
    })

    if (!schemaResponse.ok) {
      const errorData = await schemaResponse.json()
      throw new Error(`Failed to generate schema: ${errorData.error || schemaResponse.statusText}`)
    }

    console.log('Schema generated successfully')

    // Step 2: Fetch the generated schema from the database
    const { data: taskData, error: taskError } = await supabaseClient
      .from('tasks')
      .select('schema_data')
      .eq('task_id', task_id)
      .single()

    if (taskError || !taskData || !taskData.schema_data) {
      throw new Error(`Failed to fetch generated schema: ${taskError?.message || 'No schema data found'}`)
    }

    const schemaData = taskData.schema_data
    console.log(`Retrieved schema data (${schemaData.length} characters)`)

    // Step 3: Insert schema into the HTML content
    let updatedContent = content || ''
    
    // Parse the schema to ensure it's valid JSON
    let schemaObject
    try {
      schemaObject = typeof schemaData === 'string' ? JSON.parse(schemaData) : schemaData
    } catch (parseError) {
      console.error('Failed to parse schema data:', parseError)
      throw new Error(`Invalid schema data: ${parseError.message}`)
    }

    // Create the script tag with the schema
    const schemaScriptTag = `<script type="application/ld+json">${JSON.stringify(schemaObject)}</script>`

    // Check if content already has a schema script tag
    const existingSchemaRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi
    
    if (existingSchemaRegex.test(updatedContent)) {
      console.log('Replacing existing schema in content')
      updatedContent = updatedContent.replace(existingSchemaRegex, schemaScriptTag)
    } else {
      console.log('Adding schema to content')
      // Add schema at the beginning of the content, after any lead image
      const leadImageRegex = /<div[^>]*class=["']lead-image["'][^>]*>[\s\S]*?<\/div>/i
      const leadImageMatch = updatedContent.match(leadImageRegex)
      
      if (leadImageMatch) {
        // Insert after lead image
        const insertPosition = leadImageMatch.index + leadImageMatch[0].length
        updatedContent = updatedContent.slice(0, insertPosition) + '\n' + schemaScriptTag + '\n' + updatedContent.slice(insertPosition)
      } else {
        // Insert at the beginning
        updatedContent = schemaScriptTag + '\n\n' + updatedContent
      }
    }

    // Step 4: Update the Shopify article with the new content
    console.log(`Updating Shopify article ${shopify_article_id} with schema`)
    
    const shopifyDomain = shopify_config.shopify_domain
    const shopifyToken = shopify_config.shopify_access_token
    const blogId = shopify_config.shopify_blog_id
    const apiVersion = shopify_config.shopify_api_version || '2023-10'

    const updateResponse = await fetch(
      `https://${shopifyDomain}/admin/api/${apiVersion}/blogs/${blogId}/articles/${shopify_article_id}.json`,
      {
        method: 'PUT',
        headers: {
          'X-Shopify-Access-Token': shopifyToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          article: {
            id: parseInt(shopify_article_id),
            body_html: updatedContent
          }
        })
      }
    )

    if (!updateResponse.ok) {
      const errorText = await updateResponse.text()
      throw new Error(`Failed to update Shopify article: ${errorText}`)
    }

    const updateData = await updateResponse.json()
    console.log(`Successfully updated Shopify article ${shopify_article_id}`)

    // Step 5: Update the tasks table to indicate schema has been added
    const { error: updateError } = await supabaseClient
      .from('tasks')
      .update({ 
        schema_added_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('task_id', task_id)

    if (updateError) {
      console.error('Failed to update task with schema status:', updateError)
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        message: 'Schema generated and Shopify article updated successfully',
        task_id,
        article_id: shopify_article_id,
        schema_length: schemaData.length
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error in generate-schema-and-update-shopify:', error)
    
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})