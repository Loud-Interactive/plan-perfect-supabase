// supabase/functions/api/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { v4 as uuidv4 } from 'https://esm.sh/uuid@9.0.0'
import { PostgrestResponse } from 'https://esm.sh/@supabase/postgrest-js'

interface Task {
  task_id?: string;
  status?: string;
  title?: string;
  seo_keyword?: string;
  content_plan_guid?: string;
  content_plan_outline_guid?: string;
  client_name?: string;
  client_domain?: string;
  content?: string;
  unedited_content?: string;
  message?: string;
  html_link?: string;
  google_doc_link?: string;
  live_post_url?: string;
  email?: string;
  created_at?: string;
  last_updated_at?: string;
  factcheck_guid?: string;
  factcheck_status?: string;
  index_guid?: string;
  index_status?: string;
  schema_data?: string;
  meta_description?: string;
}

serve(async (req) => {
  // Set CORS headers for all responses
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS'
  }

  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders, status: 204 })
  }

  // Initialize Supabase client with service role key for admin rights
  const supabaseClient = createClient(
    Deno.env.get('SUPABASE_URL') || '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  )

  const url = new URL(req.url)
  const path = url.pathname
  
  try {
    // PING endpoint - Health check
    if (path === '/api/ping' && req.method === 'GET') {
      try {
        // Perform a simple query to check database connectivity
        const { data, error } = await supabaseClient
          .from('tasks')
          .select('*')
          .not('is_deleted', 'is', true) // Filter out soft-deleted records
          .limit(1)
          
        if (error) {
          throw error
        }
        
        return new Response(
          JSON.stringify({
            status: "ok",
            message: "API is running and database connection is established",
            timestamp: new Date().toISOString()
          }),
          { 
            status: 200, 
            headers: { 
              ...corsHeaders, 
              'Content-Type': 'application/json' 
            } 
          }
        )
      } catch (error) {
        console.error(`Database ping failed: ${error.message}`)
        return new Response(
          JSON.stringify({
            status: "error",
            message: `API is running but database connection failed: ${error.message}`,
            timestamp: new Date().toISOString()
          }),
          { 
            status: 500, 
            headers: { 
              ...corsHeaders, 
              'Content-Type': 'application/json' 
            } 
          }
        )
      }
    }
    
    // ADD TASK endpoint
    else if (path === '/api/content/add' && req.method === 'POST') {
      // Parse request body
      const taskData: Task = await req.json()
      
      // Set timestamps
      const now = new Date().toISOString()
      
      // First check if a task with this content_plan_outline_guid already exists
      if (taskData.content_plan_outline_guid) {
        console.log(`Checking if task with content_plan_outline_guid ${taskData.content_plan_outline_guid} already exists`)
        
        const { data: existingTask, error: findError } = await supabaseClient
          .from('tasks')
          .select('task_id')
          .eq('content_plan_outline_guid', taskData.content_plan_outline_guid)
          .not('is_deleted', 'is', true) // Filter out soft-deleted records
          .order('created_at', { ascending: false })
          .limit(1)
        
        if (findError) {
          console.error(`Error checking for existing task: ${findError.message}`)
          throw findError
        }
        
        // If the task exists, update it instead of creating a new one
        if (existingTask && existingTask.length > 0) {
          const existingTaskId = existingTask[0].task_id
          console.log(`Found existing task with ID: ${existingTaskId}, updating instead of creating new`)
          
          // Update the existing task - filter out invalid fields
          const validUpdateFields: Record<string, any> = {}
          const updateFields = [
            'status', 'title', 'seo_keyword', 'content_plan_guid',
            'client_name', 'client_domain', 'content', 'unedited_content',
            'message', 'html_link', 'google_doc_link', 'live_post_url',
            'email', 'factcheck_guid', 'factcheck_status', 'index_guid',
            'index_status', 'schema_data', 'meta_description'
          ]
          
          for (const field of updateFields) {
            if (taskData[field] !== undefined) {
              validUpdateFields[field] = taskData[field]
            }
          }
          
          validUpdateFields.last_updated_at = now
          
          const { data: updatedTask, error: updateError } = await supabaseClient
            .from('tasks')
            .update(validUpdateFields)
            .eq('task_id', existingTaskId)
            .select()
          
          if (updateError) {
            console.error(`Failed to update existing task: ${updateError.message}`)
            throw updateError
          }
          
          console.log(`Successfully updated existing task with ID: ${existingTaskId}`)
          
          return new Response(
            JSON.stringify(updatedTask[0]),
            { 
              status: 200, 
              headers: { 
                ...corsHeaders, 
                'Content-Type': 'application/json' 
              } 
            }
          )
        }
      }
      
      // If no existing task found or no content_plan_outline_guid provided, create a new task
      // Generate a unique task ID
      const task_id = uuidv4()
      
      // Prepare the task data for insertion - filter out invalid fields
      const validInsertFields = [
        'status', 'title', 'seo_keyword', 'content_plan_guid',
        'content_plan_outline_guid', 'client_name', 'client_domain',
        'content', 'unedited_content', 'message', 'html_link',
        'google_doc_link', 'live_post_url', 'email', 'factcheck_guid',
        'factcheck_status', 'index_guid', 'index_status', 'schema_data',
        'meta_description'
      ]
      
      const newTask: Record<string, any> = {
        task_id,
        created_at: now,
        last_updated_at: now
      }
      
      for (const field of validInsertFields) {
        if (taskData[field] !== undefined) {
          newTask[field] = taskData[field]
        }
      }
      
      console.log(`Inserting new task with ID: ${task_id}`)
      
      // Insert the task into the database
      const { data, error } = await supabaseClient
        .from('tasks')
        .insert(newTask)
        .select()
      
      if (error) {
        console.error(`Failed to insert task: ${error.message}`)
        throw error
      }
      
      console.log(`Successfully inserted task with ID: ${task_id}`)
      
      return new Response(
        JSON.stringify(data[0]),
        { 
          status: 201, 
          headers: { 
            ...corsHeaders, 
            'Content-Type': 'application/json' 
          } 
        }
      )
    }
    
    // GET CONTENT STATUS endpoint
    else if (path.match(/^\/api\/content\/[^/]+\/status$/) && req.method === 'GET') {
      // Extract content_plan_outline_guid from path
      const guid = path.split('/')[3]
      
      console.log(`Getting content status for content_plan_outline_guid: ${guid}`)
      
      // Query the most recent task with this content_plan_outline_guid
      const { data, error } = await supabaseClient
        .from('tasks')
        .select('task_id,status,content_plan_guid,content_plan_outline_guid,client_name,client_domain,factcheck_status,index_status')
        .eq('content_plan_outline_guid', guid)
        .not('is_deleted', 'is', true) // Filter out soft-deleted records
        .order('created_at', { ascending: false })
        .limit(1)
      
      if (error) {
        console.error(`Error fetching task: ${error.message}`)
        throw error
      }
      
      if (!data || data.length === 0) {
        console.warn(`No task found for content_plan_outline_guid: ${guid}`)
        return new Response(
          JSON.stringify({ 
            error: `No task found for content_plan_outline_guid: ${guid}` 
          }),
          { 
            status: 404, 
            headers: { 
              ...corsHeaders, 
              'Content-Type': 'application/json' 
            } 
          }
        )
      }
      
      console.log(`Found task with status: ${data[0].status}`)
      
      return new Response(
        JSON.stringify(data[0]),
        { 
          status: 200, 
          headers: { 
            ...corsHeaders, 
            'Content-Type': 'application/json' 
          } 
        }
      )
    }
    
    // UPDATE LIVE POST URL endpoint
    else if (path.match(/^\/api\/content\/posts\/[^/]+\/live-post-url$/) && req.method === 'PUT') {
      // Extract guid from path
      const guid = path.split('/')[4]
      
      // Parse request body to get live_post_url
      const { live_post_url } = await req.json()
      
      console.log(`Attempting to update live post URL for GUID: ${guid}`)
      console.log(`New URL: ${live_post_url}`)
      
      // Find the most recent task with this content_plan_outline_guid
      const { data: taskData, error: taskError } = await supabaseClient
        .from('tasks')
        .select('task_id')
        .eq('content_plan_outline_guid', guid)
        .order('created_at', { ascending: false })
        .limit(1)
      
      if (taskError) {
        console.error(`Error finding task: ${taskError.message}`)
        throw taskError
      }
      
      if (!taskData || taskData.length === 0) {
        console.error(`Task not found for GUID ${guid}`)
        return new Response(
          JSON.stringify({ error: `Task not found for GUID ${guid}` }),
          { 
            status: 404, 
            headers: { 
              ...corsHeaders, 
              'Content-Type': 'application/json' 
            } 
          }
        )
      }
      
      const task_id = taskData[0].task_id
      console.log(`Found task with ID: ${task_id}`)
      
      // Format the current timestamp
      const now = new Date().toISOString()
      
      // Update the task with the new live_post_url
      const { data: updatedTask, error: updateError } = await supabaseClient
        .from('tasks')
        .update({
          live_post_url: live_post_url,
          last_updated_at: now
        })
        .eq('task_id', task_id)
        .select()
      
      if (updateError) {
        console.error(`Error updating task: ${updateError.message}`)
        throw updateError
      }
      
      console.log(`Successfully updated live_post_url for task ${task_id}`)
      
      return new Response(
        JSON.stringify(updatedTask[0]),
        { 
          status: 200, 
          headers: { 
            ...corsHeaders, 
            'Content-Type': 'application/json' 
          } 
        }
      )
    }
    
    // UPDATE TASK endpoint - PUT /content/update/{content_plan_outline_guid}
    else if (path.match(/^\/api\/content\/update\/[^/]+$/) && req.method === 'PUT') {
      // Extract content_plan_outline_guid from path
      const guid = path.split('/')[4]
      
      // Parse request body to get task update data
      const requestBody = await req.json()
      
      // Transform 'domain' to 'client_domain' for backward compatibility
      if (requestBody.domain && !requestBody.client_domain) {
        requestBody.client_domain = requestBody.domain;
        delete requestBody.domain;
        console.log('Transformed domain field to client_domain for backward compatibility');
      }
      
      // Filter out invalid fields - only allow valid task table columns
      const validFields = [
        'status', 'title', 'seo_keyword', 'content_plan_guid',
        'content_plan_outline_guid', 'client_name', 'client_domain',
        'content', 'message', 'html_link', 'google_doc_link',
        'live_post_url', 'email', 'factcheck_guid', 'factcheck_status',
        'index_guid', 'index_status', 'schema_data', 'meta_description'
      ]
      
      const taskUpdate: Record<string, any> = {}
      const invalidFields: string[] = []
      
      for (const [key, value] of Object.entries(requestBody)) {
        if (validFields.includes(key)) {
          taskUpdate[key] = value
        } else {
          invalidFields.push(key)
        }
      }
      
      if (invalidFields.length > 0) {
        console.log(`Warning: Ignoring invalid fields: ${invalidFields.join(', ')}`)
      }
      
      console.log(`Updating task for content_plan_outline_guid: ${guid}`)
      console.log(`Valid fields to update: ${JSON.stringify(taskUpdate)}`)
      
      // Find the most recent task with this content_plan_outline_guid
      const { data: existingTask, error: findError } = await supabaseClient
        .from('tasks')
        .select('*')
        .eq('content_plan_outline_guid', guid)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()
      
      if (findError && findError.code !== 'PGRST116') { // PGRST116 is "no rows returned" error
        console.error(`Error finding task: ${findError.message}`)
        throw findError
      }
      
      const now = new Date().toISOString()
      
      if (!existingTask) {
        // Task doesn't exist, create a new one
        const newGuid = uuidv4()
        const newTask = {
          task_id: newGuid,
          content_plan_outline_guid: guid,
          ...taskUpdate,
          created_at: now,
          last_updated_at: now
        }
        
        const { data: insertedTask, error: insertError } = await supabaseClient
          .from('tasks')
          .insert(newTask)
          .select()
        
        if (insertError) {
          console.error(`Error creating task: ${insertError.message}`)
          throw insertError
        }
        
        console.log(`Task created with ID: ${newGuid}`)
        
        return new Response(
          JSON.stringify(insertedTask[0]),
          { 
            status: 201, 
            headers: { 
              ...corsHeaders, 
              'Content-Type': 'application/json' 
            } 
          }
        )
      } else {
        // Task exists, update it
        // Add last_updated_at to the already filtered taskUpdate
        taskUpdate.last_updated_at = now
        
        const { data: updatedTask, error: updateError } = await supabaseClient
          .from('tasks')
          .update(taskUpdate)
          .eq('task_id', existingTask.task_id)
          .select()
        
        if (updateError) {
          console.error(`Error updating task: ${updateError.message}`)
          throw updateError
        }
        
        console.log(`Task updated with ID: ${existingTask.task_id}`)
        
        return new Response(
          JSON.stringify(updatedTask[0]),
          { 
            status: 200, 
            headers: { 
              ...corsHeaders, 
              'Content-Type': 'application/json' 
            } 
          }
        )
      }
    }
    
    // GET CONTENT STATUS (alternate endpoint format)
    else if (path.match(/^\/api\/content\/status\/[^/]+$/) && req.method === 'GET') {
      // Extract content_plan_outline_guid from path
      const guid = path.split('/')[4]
      
      console.log(`Getting detailed content status for content_plan_outline_guid: ${guid}`)
      
      // Query the most recent task with this content_plan_outline_guid
      const { data, error } = await supabaseClient
        .from('tasks')
        .select('*')
        .eq('content_plan_outline_guid', guid)
        .not('is_deleted', 'is', true) // Filter out soft-deleted records
        .order('created_at', { ascending: false })
        .limit(1)
      
      if (error) {
        console.error(`Error fetching task: ${error.message}`)
        throw error
      }
      
      if (!data || data.length === 0) {
        console.warn(`No task found for content_plan_outline_guid: ${guid}`)
        return new Response(
          JSON.stringify({ 
            error: `No task found for content_plan_outline_guid: ${guid}` 
          }),
          { 
            status: 404, 
            headers: { 
              ...corsHeaders, 
              'Content-Type': 'application/json' 
            } 
          }
        )
      }
      
      console.log(`Found task with ID: ${data[0].task_id}`)
      
      return new Response(
        JSON.stringify(data[0]),
        { 
          status: 200, 
          headers: { 
            ...corsHeaders, 
            'Content-Type': 'application/json' 
          } 
        }
      )
    }
    
    // GET TASKS BY DOMAIN
    else if (path.match(/^\/api\/content\/domain\/[^/]+$/) && req.method === 'GET') {
      // Extract domain from path
      const domain = path.split('/')[4]
      
      // Parse query parameters
      const urlParams = new URL(req.url).searchParams
      const skip = parseInt(urlParams.get('skip') || '0')
      const limit = Math.min(parseInt(urlParams.get('limit') || '100'), 1000)
      const hasLivePostUrl = urlParams.get('has_live_post_url')
      const status = urlParams.get('status')
      
      console.log(`Getting tasks for domain: ${domain}`)
      console.log(`Pagination: skip=${skip}, limit=${limit}`)
      console.log(`Filters: hasLivePostUrl=${hasLivePostUrl}, status=${status}`)
      
      // Start building query
      let query = supabaseClient
        .from('tasks')
        .select('*', { count: 'exact' })
        .eq('client_domain', domain)
        .not('content_plan_outline_guid', 'is', null)
        .not('is_deleted', 'is', true) // Filter out soft-deleted records
      
      // Add status filter if specified
      if (status) {
        const statusLower = status.toLowerCase()
        if (statusLower === 'completed') {
          query = query.or('status.eq.completed,status.eq.complete')
        } else if (statusLower === 'processing' || statusLower === 'pending') {
          query = query.not('status', 'in', '["completed","complete"]')
        }
      }
      
      // Add live post URL filter if specified
      if (hasLivePostUrl) {
        const hasLivePostUrlLower = hasLivePostUrl.toLowerCase()
        if (['true', '1', 'yes'].includes(hasLivePostUrlLower)) {
          query = query.not('live_post_url', 'is', null).neq('live_post_url', '')
        } else if (['false', '0', 'no'].includes(hasLivePostUrlLower)) {
          query = query.or('live_post_url.is.null,live_post_url.eq.')
        }
      }
      
      // Execute the query with pagination
      const { data, error, count } = await query
        .order('created_at', { ascending: false })
        .range(skip, skip + limit - 1)
      
      if (error) {
        console.error(`Error fetching tasks: ${error.message}`)
        throw error
      }
      
      // Create response with pagination metadata
      const totalCount = count || 0
      const totalPages = Math.ceil(totalCount / limit) || 0
      const currentPage = Math.floor(skip / limit) + 1
      
      const responseData = {
        total: totalCount,
        page: currentPage,
        page_size: limit,
        total_pages: totalPages,
        records: data || []
      }
      
      const paginationHeaders = {
        'X-Total-Count': totalCount.toString(),
        'X-Page-Size': limit.toString(),
        'X-Page': currentPage.toString(),
        'X-Total-Pages': totalPages.toString()
      }
      
      return new Response(
        JSON.stringify(responseData),
        { 
          status: 200, 
          headers: { 
            ...corsHeaders, 
            ...paginationHeaders,
            'Content-Type': 'application/json' 
          } 
        }
      )
    }
    
    // GET CONTENT STATUS BATCH
    else if (path === '/api/content/status/batch' && req.method === 'POST') {
      // Parse request body to get GUIDs
      const { guids } = await req.json()
      
      if (!guids || !Array.isArray(guids) || guids.length === 0) {
        return new Response(
          JSON.stringify({ error: "No GUIDs provided or invalid format" }),
          { 
            status: 400, 
            headers: { 
              ...corsHeaders, 
              'Content-Type': 'application/json' 
            } 
          }
        )
      }
      
      console.log(`Getting batch status for ${guids.length} GUIDs`)
      
      // Find the latest task for each GUID
      const { data, error } = await supabaseClient.rpc('get_latest_tasks_by_guids', {
        guid_list: guids
      })
      
      if (error) {
        console.error(`Error fetching tasks: ${error.message}`)
        throw error
      }
      
      return new Response(
        JSON.stringify(data || []),
        { 
          status: 200, 
          headers: { 
            ...corsHeaders, 
            'Content-Type': 'application/json' 
          } 
        }
      )
    }
    
    // UPDATE HTML LINK
    else if (path.match(/^\/api\/content\/posts\/[^/]+\/html$/) && req.method === 'PUT') {
      // Extract guid from path
      const guid = path.split('/')[4]
      
      // Parse request body to get html_link
      const { html_link } = await req.json()
      
      console.log(`Updating HTML link for content_plan_outline_guid: ${guid}`)
      console.log(`New HTML link: ${html_link}`)
      
      // Find the most recent task with this content_plan_outline_guid
      const { data: taskData, error: taskError } = await supabaseClient
        .from('tasks')
        .select('task_id')
        .eq('content_plan_outline_guid', guid)
        .order('created_at', { ascending: false })
        .limit(1)
      
      if (taskError) {
        console.error(`Error finding task: ${taskError.message}`)
        throw taskError
      }
      
      if (!taskData || taskData.length === 0) {
        console.error(`Task not found for GUID ${guid}`)
        return new Response(
          JSON.stringify({ error: `Task not found for GUID ${guid}` }),
          { 
            status: 404, 
            headers: { 
              ...corsHeaders, 
              'Content-Type': 'application/json' 
            } 
          }
        )
      }
      
      const task_id = taskData[0].task_id
      console.log(`Found task with ID: ${task_id}`)
      
      // Update the task with the new html_link
      const now = new Date().toISOString()
      const { data: updatedTask, error: updateError } = await supabaseClient
        .from('tasks')
        .update({
          html_link: html_link,
          last_updated_at: now
        })
        .eq('task_id', task_id)
        .select()
      
      if (updateError) {
        console.error(`Error updating task: ${updateError.message}`)
        throw updateError
      }
      
      console.log(`Successfully updated html_link for task ${task_id}`)
      
      return new Response(
        JSON.stringify(updatedTask[0]),
        { 
          status: 200, 
          headers: { 
            ...corsHeaders, 
            'Content-Type': 'application/json' 
          } 
        }
      )
    }
    
    // UPDATE GOOGLE DOC LINK
    else if (path.match(/^\/api\/content\/posts\/[^/]+\/google-doc$/) && req.method === 'PUT') {
      // Extract guid from path
      const guid = path.split('/')[4]
      
      // Parse request body to get google_doc_link
      const { google_doc_link } = await req.json()
      
      console.log(`Updating Google Doc link for content_plan_outline_guid: ${guid}`)
      console.log(`New Google Doc link: ${google_doc_link}`)
      
      // Find the most recent task with this content_plan_outline_guid
      const { data: taskData, error: taskError } = await supabaseClient
        .from('tasks')
        .select('task_id')
        .eq('content_plan_outline_guid', guid)
        .order('created_at', { ascending: false })
        .limit(1)
      
      if (taskError) {
        console.error(`Error finding task: ${taskError.message}`)
        throw taskError
      }
      
      if (!taskData || taskData.length === 0) {
        console.error(`Task not found for GUID ${guid}`)
        return new Response(
          JSON.stringify({ error: `Task not found for GUID ${guid}` }),
          { 
            status: 404, 
            headers: { 
              ...corsHeaders, 
              'Content-Type': 'application/json' 
            } 
          }
        )
      }
      
      const task_id = taskData[0].task_id
      console.log(`Found task with ID: ${task_id}`)
      
      // Update the task with the new google_doc_link
      const now = new Date().toISOString()
      const { data: updatedTask, error: updateError } = await supabaseClient
        .from('tasks')
        .update({
          google_doc_link: google_doc_link,
          last_updated_at: now
        })
        .eq('task_id', task_id)
        .select()
      
      if (updateError) {
        console.error(`Error updating task: ${updateError.message}`)
        throw updateError
      }
      
      console.log(`Successfully updated google_doc_link for task ${task_id}`)
      
      return new Response(
        JSON.stringify(updatedTask[0]),
        { 
          status: 200, 
          headers: { 
            ...corsHeaders, 
            'Content-Type': 'application/json' 
          } 
        }
      )
    }
    
    // RESTORE DELETED TASK BY TASK ID
    else if (path.match(/^\/api\/content\/restore\/[^/]+$/) && req.method === 'POST') {
      // Extract task_id from path
      const task_id = path.split('/')[4]
      
      console.log(`Restoring soft-deleted task with task_id: ${task_id}`)
      
      // Restore the soft-deleted task by updating is_deleted flag
      const { data, error } = await supabaseClient
        .from('tasks')
        .update({ 
          is_deleted: false,
          last_updated_at: new Date().toISOString() // Update the timestamp
        })
        .eq('task_id', task_id)
        .eq('is_deleted', true) // Only update if it's currently soft-deleted
        .select()

      if (error) {
        console.error(`Error restoring task: ${error.message}`)
        throw error
      }
      
      if (!data || data.length === 0) {
        console.warn(`No deleted task found with task_id ${task_id}`)
        return new Response(
          JSON.stringify({ 
            error: `No deleted task found with task_id ${task_id}` 
          }),
          { 
            status: 404, 
            headers: { 
              ...corsHeaders, 
              'Content-Type': 'application/json' 
            } 
          }
        )
      }
      
      console.log(`Successfully restored task with task_id ${task_id}`)
      
      return new Response(
        JSON.stringify({
          status: "success",
          message: `Successfully restored task with task_id ${task_id}`,
          restored_task: data[0]
        }),
        { 
          status: 200, 
          headers: { 
            ...corsHeaders, 
            'Content-Type': 'application/json' 
          } 
        }
      )
    }
    
    // SOFT DELETE TASK BY TASK ID
    else if (path.match(/^\/api\/content\/delete\/[^/]+$/) && req.method === 'DELETE') {
      // Extract task_id from path
      const task_id = path.split('/')[4]
      
      console.log(`Soft deleting task with task_id: ${task_id}`)
      
      // Soft delete by updating is_deleted flag for the specific task
      const { data, error } = await supabaseClient
        .from('tasks')
        .update({ 
          is_deleted: true,
          last_updated_at: new Date().toISOString() // Update the timestamp
        })
        .eq('task_id', task_id)
        .eq('is_deleted', false) // Only update if not already soft-deleted
        .select()

      if (error) {
        console.error(`Error soft deleting task: ${error.message}`)
        throw error
      }
      
      if (!data || data.length === 0) {
        console.warn(`No active task found with task_id ${task_id}`)
        return new Response(
          JSON.stringify({ 
            error: `No active task found with task_id ${task_id}` 
          }),
          { 
            status: 404, 
            headers: { 
              ...corsHeaders, 
              'Content-Type': 'application/json' 
            } 
          }
        )
      }
      
      console.log(`Successfully soft deleted task with task_id ${task_id}`)
      
      return new Response(
        JSON.stringify({
          status: "success",
          message: `Successfully soft deleted task with task_id ${task_id}`,
          deleted_task: data[0]
        }),
        { 
          status: 200, 
          headers: { 
            ...corsHeaders, 
            'Content-Type': 'application/json' 
          } 
        }
      )
    }
    
    // GET TASKS BY EMAIL
    else if (path.match(/^\/api\/content\/email\/[^/]+$/) && req.method === 'GET') {
      // Extract email from path
      const email = path.split('/')[4]
      
      // Parse query parameters
      const urlParams = new URL(req.url).searchParams
      const skip = parseInt(urlParams.get('skip') || '0')
      const limit = Math.min(parseInt(urlParams.get('limit') || '100'), 1000)
      const status = urlParams.get('status')
      
      console.log(`Getting tasks for email: ${email}`)
      console.log(`Pagination: skip=${skip}, limit=${limit}`)
      console.log(`Filters: status=${status}`)
      
      // Start building query
      let query = supabaseClient
        .from('tasks')
        .select('*', { count: 'exact' })
        .eq('email', email)
        .not('content_plan_outline_guid', 'is', null)
        .not('is_deleted', 'is', true) // Filter out soft-deleted records
      
      // Add status filter if specified
      if (status) {
        const statusLower = status.toLowerCase()
        if (statusLower === 'completed') {
          query = query.or('status.eq.completed,status.eq.complete')
        } else if (statusLower === 'processing' || statusLower === 'pending') {
          query = query.not('status', 'in', '["completed","complete"]')
        }
      }
      
      // Execute the query with pagination
      const { data, error, count } = await query
        .order('created_at', { ascending: false })
        .range(skip, skip + limit - 1)
      
      if (error) {
        console.error(`Error fetching tasks: ${error.message}`)
        throw error
      }
      
      // Create response with pagination metadata
      const totalCount = count || 0
      const totalPages = Math.ceil(totalCount / limit) || 0
      const currentPage = Math.floor(skip / limit) + 1
      
      const responseData = {
        total: totalCount,
        page: currentPage,
        page_size: limit,
        total_pages: totalPages,
        records: data || []
      }
      
      const paginationHeaders = {
        'X-Total-Count': totalCount.toString(),
        'X-Page-Size': limit.toString(),
        'X-Page': currentPage.toString(),
        'X-Total-Pages': totalPages.toString()
      }
      
      return new Response(
        JSON.stringify(responseData),
        { 
          status: 200, 
          headers: { 
            ...corsHeaders, 
            ...paginationHeaders,
            'Content-Type': 'application/json' 
          } 
        }
      )
    }
    
    // GET DELETED TASKS - ADMIN ENDPOINT
    else if (path === '/api/admin/deleted-tasks' && req.method === 'GET') {
      // Parse query parameters for pagination
      const urlParams = new URL(req.url).searchParams
      const skip = parseInt(urlParams.get('skip') || '0')
      const limit = Math.min(parseInt(urlParams.get('limit') || '100'), 1000)
      const clientDomain = urlParams.get('client_domain')
      const email = urlParams.get('email')
      
      console.log(`Getting deleted tasks. Pagination: skip=${skip}, limit=${limit}`)
      
      // Start building query specifically for deleted tasks
      let query = supabaseClient
        .from('tasks')
        .select('*', { count: 'exact' })
        .eq('is_deleted', true)
      
      // Add client domain filter if specified
      if (clientDomain) {
        query = query.eq('client_domain', clientDomain)
      }
      
      // Add email filter if specified
      if (email) {
        query = query.eq('email', email)
      }
      
      // Execute the query with pagination
      const { data, error, count } = await query
        .order('updated_at', { ascending: false })
        .range(skip, skip + limit - 1)
      
      if (error) {
        console.error(`Error fetching deleted tasks: ${error.message}`)
        throw error
      }
      
      // Create response with pagination metadata
      const totalCount = count || 0
      const totalPages = Math.ceil(totalCount / limit) || 0
      const currentPage = Math.floor(skip / limit) + 1
      
      const responseData = {
        total: totalCount,
        page: currentPage,
        page_size: limit,
        total_pages: totalPages,
        records: data || []
      }
      
      const paginationHeaders = {
        'X-Total-Count': totalCount.toString(),
        'X-Page-Size': limit.toString(),
        'X-Page': currentPage.toString(),
        'X-Total-Pages': totalPages.toString()
      }
      
      return new Response(
        JSON.stringify(responseData),
        { 
          status: 200, 
          headers: { 
            ...corsHeaders, 
            ...paginationHeaders,
            'Content-Type': 'application/json' 
          } 
        }
      )
    }
    
    // PATCH TASK FIELD
    else if ((path.match(/^\/api\/content\/update\/[^/]+\/field$/) || 
             path.match(/^\/api\/content\/posts\/[^/]+\/field$/)) && 
             req.method === 'PATCH') {
      // Extract guid from path
      const pathParts = path.split('/')
      const guid = pathParts[pathParts.length - 2]
      
      // Parse request body to get field details
      const requestBody = await req.json()
      const fieldName = requestBody.field || requestBody.field_name
      const fieldValue = requestBody.value || requestBody.field_value
      
      if (!fieldName || fieldValue === undefined) {
        return new Response(
          JSON.stringify({ error: "Field name and value are required" }),
          { 
            status: 400, 
            headers: { 
              ...corsHeaders, 
              'Content-Type': 'application/json' 
            } 
          }
        )
      }
      
      console.log(`Updating field "${fieldName}" for content_plan_outline_guid: ${guid}`)
      console.log(`New value: ${fieldValue}`)
      
      // Find the most recent task with this content_plan_outline_guid
      const { data: taskData, error: taskError } = await supabaseClient
        .from('tasks')
        .select('task_id')
        .eq('content_plan_outline_guid', guid)
        .order('created_at', { ascending: false })
        .limit(1)
      
      if (taskError) {
        console.error(`Error finding task: ${taskError.message}`)
        throw taskError
      }
      
      if (!taskData || taskData.length === 0) {
        console.error(`Task not found for GUID ${guid}`)
        return new Response(
          JSON.stringify({ error: `Task not found for GUID ${guid}` }),
          { 
            status: 404, 
            headers: { 
              ...corsHeaders, 
              'Content-Type': 'application/json' 
            } 
          }
        )
      }
      
      const task_id = taskData[0].task_id
      console.log(`Found task with ID: ${task_id}`)
      
      // Validate the field name
      const validFields = [
        'status', 'title', 'seo_keyword', 'content_plan_guid',
        'content_plan_outline_guid', 'client_name', 'client_domain',
        'content', 'message', 'html_link', 'google_doc_link',
        'live_post_url', 'email', 'factcheck_guid', 'factcheck_status',
        'index_guid', 'index_status', 'schema_data', 'meta_description'
      ]
      
      if (!validFields.includes(fieldName)) {
        return new Response(
          JSON.stringify({ error: `Invalid field name: ${fieldName}` }),
          { 
            status: 400, 
            headers: { 
              ...corsHeaders, 
              'Content-Type': 'application/json' 
            } 
          }
        )
      }
      
      // Update the task with the new field value
      const now = new Date().toISOString()
      const updateData: Record<string, any> = {
        last_updated_at: now
      }
      updateData[fieldName] = fieldValue
      
      const { data: updatedTask, error: updateError } = await supabaseClient
        .from('tasks')
        .update(updateData)
        .eq('task_id', task_id)
        .select()
      
      if (updateError) {
        console.error(`Error updating task: ${updateError.message}`)
        throw updateError
      }
      
      console.log(`Successfully updated ${fieldName} for task ${task_id}`)
      
      return new Response(
        JSON.stringify(updatedTask[0]),
        { 
          status: 200, 
          headers: { 
            ...corsHeaders, 
            'Content-Type': 'application/json' 
          } 
        }
      )
    }
    
    // If no route matches
    return new Response(
      JSON.stringify({ error: 'Not Found' }),
      { 
        status: 404, 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        } 
      }
    )
    
  } catch (error) {
    console.error(`Unhandled error: ${error.message}`)
    
    return new Response(
      JSON.stringify({ 
        error: `An unexpected error occurred: ${error.message}` 
      }),
      { 
        status: 500, 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        } 
      }
    )
  }
})