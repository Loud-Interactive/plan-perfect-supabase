// supabase/functions/update-content-plan/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { v4 as uuidv4 } from 'https://esm.sh/uuid@9.0.0'

interface ContentPlanItem {
  'Hub Number': string;
  'Spoke Number': string;
  'Post Title': string;
  'Keyword': string;
  'URL Slug': string;
  'CPC': string;
  'Difficulty': string;
  'Volume': string;
  'guid': string | null;
}

interface ContentPlan {
  guid?: string;
  domain_name: string;
  keyword: string;
  content_plan: string;
  content_plan_table: string;
  timestamp?: string;
  enhanced_analysis?: string | null;
  semantic_clusters?: string | null;
  content_strategy?: string | null;
  status?: string | null;
  error_message?: string | null;
  email?: string | null;
}

// Generate a markdown table from content plan items
function generateMarkdownTable(contentPlanItems: ContentPlanItem[]): string {
  let table = '| Day | Hub Number | Spoke Number | Post Title | Keyword | URL Slug | CPC | Difficulty | Volume |\n';
  table += '|-----|------------|--------------|------------|---------|----------|-----|------------|--------|\n';

  contentPlanItems.forEach(item => {
    table += `| | ${item['Hub Number']} | ${item['Spoke Number']} | ${item['Post Title']} | ${item['Keyword']} | ${item['URL Slug']} | ${item['CPC']} | ${item['Difficulty']} | ${item['Volume']} |\n`;
  });

  return table;
}

// Generate fresh GUIDs for content plan items
function generateGuidsForContentPlan(contentPlanItems: ContentPlanItem[]): ContentPlanItem[] {
  return contentPlanItems.map(item => ({
    ...item,
    guid: uuidv4()
  }));
}

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
    const requestData = await req.json()
    const { guid, domain_name, keyword, content_plan, email } = requestData
    
    console.log(`Processing content plan update request`)
    
    // Instead of requiring specific fields, we'll just ensure we have a guid for updates
    if (guid && typeof guid !== 'string') {
      return new Response(
        JSON.stringify({ error: "guid must be a valid string if provided" }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    
    // Initialize Supabase client with service role key for admin rights
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    )
    
    // Prepare the data for updating or inserting
    // We'll create a mutable copy of the request data that we can modify
    const contentPlanData = { ...requestData }
    
    console.log("Request data received:", JSON.stringify(requestData, null, 2))
    
    // Add timestamp if not provided
    if (!contentPlanData.timestamp) {
      contentPlanData.timestamp = new Date().toISOString()
    }
    
    // Process content plan data - could be in content_plan or content_plan_table field
    let contentPlanItems: ContentPlanItem[] = []
    let contentPlanSource = null
      
    console.log("Content plan data types:", {
      content_plan_type: typeof contentPlanData.content_plan,
      content_plan_table_type: typeof contentPlanData.content_plan_table,
      content_plan_length: typeof contentPlanData.content_plan === 'string' ? 
        contentPlanData.content_plan.length : 
        (Array.isArray(contentPlanData.content_plan) ? contentPlanData.content_plan.length : 'N/A'),
      content_plan_table_length: typeof contentPlanData.content_plan_table === 'string' ? 
        contentPlanData.content_plan_table.length : 
        (Array.isArray(contentPlanData.content_plan_table) ? contentPlanData.content_plan_table.length : 'N/A')
    })
      
    // Check for content_plan field
    if (contentPlanData.content_plan) {
      contentPlanSource = 'content_plan'
      // Parse content plan if it's a string, otherwise assume it's already an array
      if (typeof contentPlanData.content_plan === 'string') {
        try {
          console.log("Parsing content_plan string...")
          contentPlanItems = JSON.parse(contentPlanData.content_plan)
          console.log(`Successfully parsed content_plan string into array of ${contentPlanItems.length} items`)
        } catch (e) {
          console.warn("Failed to parse content_plan string:", e.message)
          console.log("First 100 chars of content_plan:", contentPlanData.content_plan.substring(0, 100))
        }
      } else if (Array.isArray(contentPlanData.content_plan)) {
        contentPlanItems = contentPlanData.content_plan
        console.log(`Using content_plan array with ${contentPlanItems.length} items`)
      } else {
        console.warn(`Unexpected content_plan type: ${typeof contentPlanData.content_plan}`)
      }
    } 
    // Check for content_plan_table field
    else if (contentPlanData.content_plan_table) {
      contentPlanSource = 'content_plan_table'
      // Parse content plan table if it's a string, otherwise assume it's already an array
      if (typeof contentPlanData.content_plan_table === 'string') {
        try {
          console.log("Parsing content_plan_table string...")
          contentPlanItems = JSON.parse(contentPlanData.content_plan_table)
          console.log(`Successfully parsed content_plan_table string into array of ${contentPlanItems.length} items`)
        } catch (e) {
          console.warn("Failed to parse content_plan_table string:", e.message)
          console.log("First 100 chars of content_plan_table:", contentPlanData.content_plan_table.substring(0, 100))
        }
      } else if (Array.isArray(contentPlanData.content_plan_table)) {
        contentPlanItems = contentPlanData.content_plan_table
        console.log(`Using content_plan_table array with ${contentPlanItems.length} items`)
      } else {
        console.warn(`Unexpected content_plan_table type: ${typeof contentPlanData.content_plan_table}`)
      }
    } else {
      console.warn("No content plan data found in either content_plan or content_plan_table fields")
    }
      
    // If we have valid content plan items, process them
    if (Array.isArray(contentPlanItems) && contentPlanItems.length > 0) {
      console.log(`Processing ${contentPlanItems.length} content plan items from ${contentPlanSource} field`)
      
      // Log the first item for debugging
      if (contentPlanItems.length > 0) {
        console.log("Sample content plan item:", JSON.stringify(contentPlanItems[0], null, 2))
      }
      
      // Generate GUIDs for content plan items if they don't have one
      const updatedContentPlanItems = generateGuidsForContentPlan(contentPlanItems)
      console.log(`Generated GUIDs for ${updatedContentPlanItems.length} items`)
      
      // Update the content plan data in both potential fields
      contentPlanData.content_plan = JSON.stringify(updatedContentPlanItems)
      
      // Generate markdown table if possible
      try {
        const markdownTable = generateMarkdownTable(updatedContentPlanItems)
        console.log(`Generated markdown table (${markdownTable.length} chars)`)
        contentPlanData.content_plan_table = markdownTable
      } catch (e) {
        console.warn("Failed to generate markdown table:", e)
        console.error(e.stack)
      }
    } else {
      console.warn("No valid content plan items to process")
    }
    
    // Set status to pending if not provided
    if (!contentPlanData.status) {
      contentPlanData.status = 'pending'
    }
    
    let result
    
    // Remove guid from contentPlanData - we'll use it for the query but don't need to update it
    if (guid) {
      delete contentPlanData.guid
    }
    
    // Log the final data we're about to save
    console.log("Content plan data to save:", {
      guid: guid || contentPlanData.guid || 'to be generated',
      domain_name: contentPlanData.domain_name,
      keyword: contentPlanData.keyword,
      content_plan_length: contentPlanData.content_plan ? contentPlanData.content_plan.length : 'not set',
      content_plan_table_length: contentPlanData.content_plan_table ? contentPlanData.content_plan_table.length : 'not set',
      status: contentPlanData.status,
    })
    
    if (guid) {
      // Update existing record
      console.log(`Updating existing content plan with guid: ${guid}`)
      
      const { data: updateData, error: updateError } = await supabaseClient
        .from('content_plans')
        .update(contentPlanData)
        .eq('guid', guid)
        .select()
      
      if (updateError) {
        console.error(`Error updating content plan: ${updateError.message}`)
        console.error(`Update error details:`, updateError)
        throw updateError
      }
      
      console.log(`Update response:`, updateData)
      result = updateData?.[0]
    } else {
      // Insert new record
      console.log('Creating new content plan')
      
      // Generate a new guid if not provided
      if (!contentPlanData.guid) {
        contentPlanData.guid = uuidv4()
        console.log(`Generated new guid: ${contentPlanData.guid}`)
      }
      
      const { data: insertData, error: insertError } = await supabaseClient
        .from('content_plans')
        .insert(contentPlanData)
        .select()
      
      if (insertError) {
        console.error(`Error inserting content plan: ${insertError.message}`)
        console.error(`Insert error details:`, insertError)
        throw insertError
      }
      
      console.log(`Insert response:`, insertData)
      result = insertData?.[0]
    }
    
    console.log(`Successfully saved content plan with guid: ${result?.guid}`)
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        message: guid ? "Content plan updated successfully" : "Content plan created successfully",
        guid: result?.guid,
        timestamp: result?.timestamp
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error("Error in content plan update process:", error)
    
    return new Response(
      JSON.stringify({ error: `Content plan update failed: ${error.message}` }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})