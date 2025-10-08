// Supabase Edge Function: process-shopify-queue
// Description: Processes items from the Shopify operation queue

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// Initialize Supabase client
const supabaseUrl = Deno.env.get('PROJECT_URL') || ''
const supabaseKey = Deno.env.get('SERVICE_ROLE_KEY') || ''
const supabase = createClient(supabaseUrl, supabaseKey)

// Shopify API constants
const SHOPIFY_API_HEADER = "X-Shopify-Access-Token"

// Main handler function
serve(async (req) => {
  // Get query params
  const url = new URL(req.url)
  const limit = parseInt(url.searchParams.get('limit') || '10')
  
  try {
    // Get pending queue items
    const { data: queueItems, error: queueError } = await supabase
      .from('outline_shopify_queue')
      .select('*')
      .is('processed_at', null)
      .order('created_at', { ascending: true })
      .limit(limit)
    
    if (queueError) {
      throw new Error(`Error fetching queue items: ${queueError.message}`)
    }
    
    if (!queueItems || queueItems.length === 0) {
      return new Response(
        JSON.stringify({ message: "No pending items in queue" }),
        { headers: { "Content-Type": "application/json" } }
      )
    }
    
    // Process each queue item
    const results = []
    for (const item of queueItems) {
      try {
        const result = await processQueueItem(item)
        results.push({ id: item.id, status: 'success', ...result })
        
        // Mark item as processed
        await supabase
          .from('outline_shopify_queue')
          .update({
            processed_at: new Date().toISOString(),
            error_message: null
          })
          .eq('id', item.id)
          
      } catch (error) {
        console.error(`Error processing queue item ${item.id}:`, error)
        
        // Update with error and increment retry count
        await supabase
          .from('outline_shopify_queue')
          .update({
            error_message: error.message,
            retries: (item.retries || 0) + 1
          })
          .eq('id', item.id)
          
        results.push({ id: item.id, status: 'error', error: error.message })
      }
    }
    
    return new Response(
      JSON.stringify({ processed: results.length, results }),
      { headers: { "Content-Type": "application/json" } }
    )
    
  } catch (error) {
    console.error("Error in process-shopify-queue:", error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500,
        headers: { "Content-Type": "application/json" } 
      }
    )
  }
})

async function processQueueItem(item) {
  // Get the task content - use maybeSingle() instead of single() to handle multiple rows
  const { data: tasks, error: taskError } = await supabase
    .from('tasks')
    .select('*')
    .eq('content_plan_outline_guid', item.content_plan_outline_guid)
    .order('created_at', { ascending: false }) // Get the most recent task
    .limit(1)
  
  if (taskError) {
    throw new Error(`Error fetching task: ${taskError.message}`)
  }
  
  if (!tasks || tasks.length === 0) {
    throw new Error(`Task not found: ${item.content_plan_outline_guid}`)
  }
  
  const task = tasks[0]
  
  // Get client's Shopify config - use maybeSingle() for safety
  const { data: shopifyConfig, error: configError } = await supabase
    .from('shopify_configs')
    .select('*')
    .eq('client_id', item.client_id)
    .maybeSingle()
  
  if (configError) {
    throw new Error(`Error fetching Shopify config: ${configError.message}`)
  }
  
  if (!shopifyConfig) {
    throw new Error(`Shopify config not found for client: ${item.client_id}`)
  }
  
  // Get existing sync status if available
  const { data: syncStatus } = await supabase
    .from('shopify_sync_status')
    .select('*')
    .eq('content_plan_outline_guid', item.content_plan_outline_guid)
    .maybeSingle()
  
  // Generate article content from task
  const articleData = await generateArticleFromTask(task, shopifyConfig)
  console.log(`Processing ${item.operation} for GUID: ${item.content_plan_outline_guid}`)
  console.log(`Article title: ${articleData.title}`)
  console.log(`Existing sync status: ${syncStatus ? 'EXISTS' : 'NONE'}`)
  
  // Perform requested operation
  switch (item.operation) {
    case 'sync':
      return await syncArticle(task, articleData, syncStatus, shopifyConfig)
    case 'update':
      return await updateArticle(task, articleData, syncStatus, shopifyConfig)
    case 'publish':
      return await publishArticle(task, item.publish_status, syncStatus, shopifyConfig)
    case 'delete':
      return await deleteArticle(task, syncStatus, shopifyConfig)
    default:
      throw new Error(`Unknown operation: ${item.operation}`)
  }
}

async function generateArticleFromTask(task, shopifyConfig) {
  // Extract and format content from the task
  // This implementation will depend on your task structure
  
  // Get metadata and content
  let title = task.title || 'Untitled Article'
  
  // Apply suffix if configured
  if (shopifyConfig.shopify_post_suffix) {
    title = `${title} ${shopifyConfig.shopify_post_suffix}`
  }
  
  // Format the content (assuming task.content contains HTML or Markdown)
  const bodyHtml = task.content || '<p>No content available</p>'
  
  // Construct featured image URL if available
  let featuredImage = null
  if (shopifyConfig.shopify_post_featured_image) {
    featuredImage = shopifyConfig.shopify_post_featured_image
  }
  
  // Prepare base article data
  const baseArticleData = {
    title: title.trim(),
    body_html: bodyHtml,
    author: shopifyConfig.shopify_post_author || 'Admin',
    // Add any additional metadata from the task as needed
  }
  
  // Set featured image using the correct Shopify format
  if (featuredImage) {
    baseArticleData.image = {
      src: featuredImage,
      alt: title.trim() // Use article title as alt text
    }
  }

  // Add template suffix if configured
  if (shopifyConfig.shopify_template) {
    baseArticleData.template_suffix = shopifyConfig.shopify_template
  }

  return baseArticleData
}

async function syncArticle(task, articleData, existingSyncStatus, shopifyConfig) {
  // If already synced, update instead
  if (existingSyncStatus && existingSyncStatus.shopify_article_gid) {
    return await updateArticle(task, articleData, existingSyncStatus, shopifyConfig)
  }
  
  // Create new article in Shopify
  const blogId = shopifyConfig.shopify_blog_id
  const shopifyDomain = shopifyConfig.shopify_domain
  const shopifyToken = shopifyConfig.shopify_access_token
  const apiVersion = shopifyConfig.shopify_api_version || '2023-10'
  
  // Check publish mode setting
  const publishMode = shopifyConfig.publish_mode || 'live'
  const isPublishLive = publishMode === 'live'
  
  // Create article via Shopify Admin API
  const createResponse = await fetch(
    `https://${shopifyDomain}/admin/api/${apiVersion}/blogs/${blogId}/articles.json`,
    {
      method: 'POST',
      headers: {
        [SHOPIFY_API_HEADER]: shopifyToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        article: {
          ...articleData,
          published: isPublishLive,
          published_at: isPublishLive ? new Date().toISOString() : null
        }
      })
    }
  )
  
  if (!createResponse.ok) {
    const errorText = await createResponse.text()
    throw new Error(`Failed to create Shopify article: ${errorText}`)
  }
  
  const createData = await createResponse.json()
  console.log('Shopify create response structure:', Object.keys(createData))
  console.log('Creating article with title:', articleData.title)
  
  // Handle both possible response formats
  let article
  if (createData.article) {
    article = createData.article
  } else if (createData.articles && createData.articles.length > 0) {
    article = createData.articles[0]  // Take the first article from array
  } else {
    throw new Error(`Invalid Shopify response structure: ${JSON.stringify(createData)}`)
  }
  
  if (!article) {
    throw new Error(`No article found in response: ${JSON.stringify(createData)}`)
  }
  
  // Update or create sync status
  const postUrl = `${shopifyConfig.shopify_blog_url}/${article.handle}`
  
  if (existingSyncStatus) {
    await supabase
      .from('shopify_sync_status')
      .update({
        shopify_article_gid: article.id.toString(),
        shopify_handle: article.handle,
        post_url: postUrl,
        is_published: article.published,
        last_synced_at: new Date().toISOString(),
        sync_error: null
      })
      .eq('id', existingSyncStatus.id)
  } else {
    await supabase
      .from('shopify_sync_status')
      .insert({
        content_plan_outline_guid: task.content_plan_outline_guid,
        shopify_article_gid: article.id.toString(),
        shopify_handle: article.handle,
        post_url: postUrl,
        is_published: article.published,
        last_synced_at: new Date().toISOString()
      })
  }
  
  return {
    action: 'sync',
    article_id: article.id,
    handle: article.handle,
    url: postUrl
  }
}

async function updateArticle(task, articleData, syncStatus, shopifyConfig) {
  if (!syncStatus || !syncStatus.shopify_article_gid) {
    return await syncArticle(task, articleData, syncStatus, shopifyConfig)
  }
  
  const blogId = shopifyConfig.shopify_blog_id
  const shopifyDomain = shopifyConfig.shopify_domain
  const shopifyToken = shopifyConfig.shopify_access_token
  const apiVersion = shopifyConfig.shopify_api_version || '2023-10'
  const articleId = syncStatus.shopify_article_gid
  
  // Check publish mode setting
  const publishMode = shopifyConfig.publish_mode || 'live'
  const isPublishLive = publishMode === 'live'
  
  // Update article via Shopify Admin API
  const updateResponse = await fetch(
    `https://${shopifyDomain}/admin/api/${apiVersion}/blogs/${blogId}/articles/${articleId}.json`,
    {
      method: 'PUT',
      headers: {
        [SHOPIFY_API_HEADER]: shopifyToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        article: {
          ...articleData,
          id: parseInt(articleId),
          published: isPublishLive,
          published_at: isPublishLive ? new Date().toISOString() : null
        }
      })
    }
  )
  
  if (!updateResponse.ok) {
    const errorText = await updateResponse.text()
    throw new Error(`Failed to update Shopify article: ${errorText}`)
  }
  
  const updateData = await updateResponse.json()
  const article = updateData.article
  
  // Update sync status
  const postUrl = `${shopifyConfig.shopify_blog_url}/${article.handle}`
  
  await supabase
    .from('shopify_sync_status')
    .update({
      shopify_handle: article.handle,
      post_url: postUrl,
      last_synced_at: new Date().toISOString(),
      sync_error: null
    })
    .eq('id', syncStatus.id)
  
  return {
    action: 'update',
    article_id: article.id,
    handle: article.handle,
    url: postUrl
  }
}

async function publishArticle(task, publishStatus, syncStatus, shopifyConfig) {
  if (!syncStatus || !syncStatus.shopify_article_gid) {
    throw new Error('Cannot publish article that has not been synced')
  }
  
  const blogId = shopifyConfig.shopify_blog_id
  const shopifyDomain = shopifyConfig.shopify_domain
  const shopifyToken = shopifyConfig.shopify_access_token
  const apiVersion = shopifyConfig.shopify_api_version || '2023-10'
  const articleId = syncStatus.shopify_article_gid
  
  // Default to publish if not specified
  const shouldPublish = publishStatus !== false
  
  // Update published status via Shopify Admin API
  const updateResponse = await fetch(
    `https://${shopifyDomain}/admin/api/${apiVersion}/blogs/${blogId}/articles/${articleId}.json`,
    {
      method: 'PUT',
      headers: {
        [SHOPIFY_API_HEADER]: shopifyToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        article: {
          id: parseInt(articleId),
          published: shouldPublish,
          published_at: shouldPublish ? new Date().toISOString() : null // Set or clear publish date
        }
      })
    }
  )
  
  if (!updateResponse.ok) {
    const errorText = await updateResponse.text()
    throw new Error(`Failed to update publish status: ${errorText}`)
  }
  
  const updateData = await updateResponse.json()
  const article = updateData.article
  
  // Update sync status
  await supabase
    .from('shopify_sync_status')
    .update({
      is_published: article.published,
      last_synced_at: new Date().toISOString(),
      sync_error: null
    })
    .eq('id', syncStatus.id)
  
  return {
    action: shouldPublish ? 'publish' : 'unpublish',
    article_id: article.id,
    is_published: article.published
  }
}

async function deleteArticle(task, syncStatus, shopifyConfig) {
  if (!syncStatus || !syncStatus.shopify_article_gid) {
    // If not synced, nothing to delete
    return { action: 'delete', status: 'not_synced' }
  }
  
  const blogId = shopifyConfig.shopify_blog_id
  const shopifyDomain = shopifyConfig.shopify_domain
  const shopifyToken = shopifyConfig.shopify_access_token
  const apiVersion = shopifyConfig.shopify_api_version || '2023-10'
  const articleId = syncStatus.shopify_article_gid
  
  // Delete article via Shopify Admin API
  const deleteResponse = await fetch(
    `https://${shopifyDomain}/admin/api/${apiVersion}/blogs/${blogId}/articles/${articleId}.json`,
    {
      method: 'DELETE',
      headers: {
        [SHOPIFY_API_HEADER]: shopifyToken,
      }
    }
  )
  
  if (!deleteResponse.ok) {
    const errorText = await deleteResponse.text()
    throw new Error(`Failed to delete Shopify article: ${errorText}`)
  }
  
  // Delete sync status record
  await supabase
    .from('shopify_sync_status')
    .delete()
    .eq('id', syncStatus.id)
  
  return {
    action: 'delete',
    status: 'success'
  }
}