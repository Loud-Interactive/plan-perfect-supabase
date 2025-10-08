// Enhanced Supabase Edge Function: process-shopify-queue-enhanced
// Description: Processes items from the Shopify operation queue with robust error handling

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// Initialize Supabase client
const supabaseUrl = Deno.env.get('PROJECT_URL') || ''
const supabaseKey = Deno.env.get('SERVICE_ROLE_KEY') || ''
const supabase = createClient(supabaseUrl, supabaseKey)

// Shopify API constants
const SHOPIFY_API_HEADER = "X-Shopify-Access-Token"
const MAX_RETRIES = 3
const PERMANENT_FAILURE_RETRY_COUNT = 999

// Main handler function
serve(async (req) => {
  const url = new URL(req.url)
  const limit = parseInt(url.searchParams.get('limit') || '10')
  const forceProcess = url.searchParams.get('force_process') === 'true'
  
  try {
    // Get pending queue items (including failed items if force_process is true)
    let query = supabase
      .from('outline_shopify_queue')
      .select('*')
      .order('created_at', { ascending: true })
      .limit(limit)
    
    if (forceProcess) {
      // Include items that can be retried
      query = query.or('processed_at.is.null,retries.lt.3')
    } else {
      // Only unprocessed items
      query = query.is('processed_at', null)
    }
    
    const { data: queueItems, error: queueError } = await query
    
    if (queueError) {
      throw new Error(`Error fetching queue items: ${queueError.message}`)
    }
    
    if (!queueItems || queueItems.length === 0) {
      return new Response(
        JSON.stringify({ 
          message: "No pending items in queue",
          force_process: forceProcess
        }),
        { headers: { "Content-Type": "application/json" } }
      )
    }
    
    console.log(`Processing ${queueItems.length} queue items (force_process: ${forceProcess})`)
    
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
        
        const currentRetries = (item.retries || 0) + 1
        let shouldRetry = true
        let retryCount = currentRetries
        
        // Determine if error is permanent
        if (error.message.includes('No tasks found for outline') || 
            error.message.includes('Shopify config not found') ||
            error.message.includes('Invalid outline GUID')) {
          shouldRetry = false
          retryCount = PERMANENT_FAILURE_RETRY_COUNT
        } else if (currentRetries >= MAX_RETRIES) {
          shouldRetry = false
          retryCount = PERMANENT_FAILURE_RETRY_COUNT
        }
        
        // Update with error and retry logic
        await supabase
          .from('outline_shopify_queue')
          .update({
            error_message: error.message,
            retries: retryCount,
            ...(shouldRetry ? {} : { processed_at: new Date().toISOString() })
          })
          .eq('id', item.id)
          
        results.push({ 
          id: item.id, 
          status: 'error', 
          error: error.message,
          will_retry: shouldRetry,
          retry_count: retryCount
        })
      }
    }
    
    return new Response(
      JSON.stringify({ 
        processed: results.length, 
        results,
        force_process: forceProcess
      }),
      { headers: { "Content-Type": "application/json" } }
    )
    
  } catch (error) {
    console.error("Error in process-shopify-queue-enhanced:", error)
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
  console.log(`Processing queue item ${item.id} for GUID: ${item.content_plan_outline_guid}`)
  
  // Get tasks - FIXED: Handle multiple tasks properly
  const { data: tasks, error: taskError } = await supabase
    .from('tasks')
    .select('*')
    .eq('content_plan_outline_guid', item.content_plan_outline_guid)
    .order('created_at', { ascending: false })

  if (taskError) {
    throw new Error(`Error fetching tasks: ${taskError.message}`)
  }

  if (!tasks || tasks.length === 0) {
    throw new Error(`No tasks found for outline: ${item.content_plan_outline_guid}`)
  }

  // FIXED: Select the most appropriate task (content task or latest task)
  const task = tasks.find(t => 
    t.task_type === 'content' || 
    t.title?.toLowerCase().includes('content') ||
    (t.content && t.content.trim().length > 100)
  ) || tasks[0]
  
  console.log(`Selected task: ${task.id} (type: ${task.task_type || 'unknown'}, content length: ${task.content?.length || 0})`)
  
  // Get client's Shopify config
  const { data: shopifyConfig, error: configError } = await supabase
    .from('shopify_configs')
    .select('*')
    .eq('client_id', item.client_id)
    .single()
  
  if (configError) {
    throw new Error(`Error fetching Shopify config: ${configError.message}`)
  }
  
  if (!shopifyConfig) {
    throw new Error(`Shopify config not found for client: ${item.client_id}`)
  }
  
  console.log('Shopify config loaded:')
  console.log('  - Client ID:', shopifyConfig.client_id)
  console.log('  - Domain:', shopifyConfig.shopify_domain)
  console.log('  - Template:', shopifyConfig.shopify_template || 'NOT SET')
  console.log('  - Post Suffix:', shopifyConfig.shopify_post_suffix || 'NOT SET')
  console.log('  - Author:', shopifyConfig.shopify_post_author || 'NOT SET')
  
  // Get existing sync status if available
  const { data: syncStatus } = await supabase
    .from('shopify_sync_status')
    .select('*')
    .eq('content_plan_outline_guid', item.content_plan_outline_guid)
    .maybeSingle()
  
  // Generate article content from task
  const articleData = await generateArticleFromTask(task, shopifyConfig)
  console.log(`Article title: ${articleData.title}`)
  console.log(`Existing sync status: ${syncStatus ? `EXISTS (article_id: ${syncStatus.shopify_article_gid})` : 'NONE'}`)
  
  // FIXED: Better operation handling with article existence verification
  switch (item.operation) {
    case 'sync':
      // Always check if already synced first
      if (syncStatus && syncStatus.shopify_article_gid) {
        // Verify article still exists in Shopify
        const exists = await verifyArticleExists(syncStatus.shopify_article_gid, shopifyConfig)
        if (exists) {
          console.log(`Article ${syncStatus.shopify_article_gid} exists, performing update`)
          return await updateArticle(task, articleData, syncStatus, shopifyConfig)
        }
        console.log(`Article ${syncStatus.shopify_article_gid} not found in Shopify, creating new one`)
        // Clear sync status and create new
        await clearSyncStatus(syncStatus.id, 'Article not found in Shopify, recreating')
        syncStatus.shopify_article_gid = null
      }
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

// FIXED: Add helper function to verify article exists
async function verifyArticleExists(articleId, shopifyConfig) {
  try {
    const response = await fetch(
      `https://${shopifyConfig.shopify_domain}/admin/api/${shopifyConfig.shopify_api_version || '2023-10'}/blogs/${shopifyConfig.shopify_blog_id}/articles/${articleId}.json`,
      {
        method: 'GET',
        headers: {
          [SHOPIFY_API_HEADER]: shopifyConfig.shopify_access_token,
        }
      }
    )
    return response.ok
  } catch (error) {
    console.error(`Error verifying article exists: ${error.message}`)
    return false
  }
}

// FIXED: Add helper function to clear sync status
async function clearSyncStatus(syncStatusId, reason) {
  await supabase
    .from('shopify_sync_status')
    .update({
      shopify_article_gid: null,
      shopify_handle: null,
      sync_error: reason
    })
    .eq('id', syncStatusId)
}

async function generateArticleFromTask(task, shopifyConfig) {
  // Extract and format content from the task
  let title = task.title || 'Untitled Article'
  
  // Apply suffix if configured
  if (shopifyConfig.shopify_post_suffix) {
    title = `${title} ${shopifyConfig.shopify_post_suffix}`
  }
  
  // Format the content (assuming task.content contains HTML or Markdown)
  let bodyHtml = task.content || '<p>No content available</p>'
  
  // Extract summary from the HTML content
  let summary = null
  try {
    // Look for div with id="summary" and extract the p tag content
    const summaryMatch = bodyHtml.match(/<div[^>]*id="summary"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>[\s\S]*?<\/div>/i)
    if (summaryMatch && summaryMatch[1]) {
      // Clean up the summary text - remove extra whitespace and HTML tags
      summary = summaryMatch[1]
        .replace(/<[^>]*>/g, '') // Remove any nested HTML tags
        .replace(/\s+/g, ' ') // Replace multiple whitespace with single space
        .trim()
      console.log(`Extracted summary: ${summary.substring(0, 100)}...`)
    } else {
      console.log('No summary found in expected format, will use first paragraph as fallback')
      // Fallback: try to get first paragraph
      const firstParagraph = bodyHtml.match(/<p[^>]*>([\s\S]*?)<\/p>/i)
      if (firstParagraph && firstParagraph[1]) {
        summary = firstParagraph[1]
          .replace(/<[^>]*>/g, '')
          .replace(/\s+/g, ' ')
          .trim()
          .substring(0, 300) // Limit fallback summary length
      }
    }
  } catch (error) {
    console.error('Error extracting summary:', error)
  }
  
  // ENHANCED: Generate hero image if not available and update content
  let featuredImage = null
  let heroImageUrl = task.hero_image_url
  
  // Check if we need to generate hero image
  if (!heroImageUrl && task.content_plan_outline_guid) {
    console.log(`No hero image found for task ${task.id}, generating...`)
    heroImageUrl = await generateHeroImageForTask(task.content_plan_outline_guid, task)
    console.log(`Hero image generated: ${heroImageUrl}`)
  }
  
  // Use generated hero image as featured image
  if (heroImageUrl) {
    featuredImage = heroImageUrl
    
    // ENHANCED: Replace lead-image div with generated hero image
    bodyHtml = replaceLeadImageWithHeroImage(bodyHtml, heroImageUrl, title)
  } else if (shopifyConfig.shopify_post_featured_image) {
    // Fall back to static config image
    featuredImage = shopifyConfig.shopify_post_featured_image
  }
  
  // Prepare base article data
  const baseArticleData = {
    title: title.trim(),
    body_html: bodyHtml,
    author: shopifyConfig.shopify_post_author || 'Admin',
  }
  
  // Add summary if we extracted one
  // Shopify uses 'summary_html' field for article summaries/excerpts
  if (summary) {
    baseArticleData.summary_html = summary
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

  console.log('Generated article data:')
  console.log('  - Title:', baseArticleData.title)
  console.log('  - Author:', baseArticleData.author)
  console.log('  - Summary HTML:', baseArticleData.summary_html ? `YES (${baseArticleData.summary_html.substring(0, 80)}...)` : 'NO')
  console.log('  - Template Suffix:', baseArticleData.template_suffix || 'NONE')
  console.log('  - Image:', baseArticleData.image ? `YES (src: ${baseArticleData.image.src})` : 'NO')
  console.log('  - Image Alt:', baseArticleData.image?.alt || 'N/A')
  console.log('Shopify config template value:', shopifyConfig.shopify_template || 'NOT SET')

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
  
  console.log(`Creating new article in Shopify: ${articleData.title}`)
  
  // Check publish mode setting
  const publishMode = shopifyConfig.publish_mode || 'live'
  const isPublishLive = publishMode === 'live'
  
  console.log(`Publish Mode: ${publishMode} (${isPublishLive ? 'Publishing Live' : 'Saving as Draft'})`)
  
  const payloadToSend = {
    article: {
      ...articleData,
      published: isPublishLive,
      published_at: isPublishLive ? new Date().toISOString() : null
    }
  }
  console.log('Full payload being sent to Shopify:', JSON.stringify({
    ...payloadToSend,
    article: {
      ...payloadToSend.article,
      body_html: payloadToSend.article.body_html?.substring(0, 200) + '...' // Truncate for logging
    }
  }, null, 2))
  console.log('Key fields being sent:')
  console.log('  - template_suffix:', payloadToSend.article.template_suffix || 'NOT SET')
  console.log('  - image:', payloadToSend.article.image ? 'YES' : 'NO')
  console.log('  - published:', payloadToSend.article.published)
  console.log('  - published_at:', payloadToSend.article.published_at)
  
  // Create article via Shopify Admin API
  const createResponse = await fetch(
    `https://${shopifyDomain}/admin/api/${apiVersion}/blogs/${blogId}/articles.json`,
    {
      method: 'POST',
      headers: {
        [SHOPIFY_API_HEADER]: shopifyToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payloadToSend)
    }
  )
  
  if (!createResponse.ok) {
    const errorText = await createResponse.text()
    throw new Error(`Failed to create Shopify article: ${errorText}`)
  }
  
  const createData = await createResponse.json()
  console.log('Shopify create response keys:', Object.keys(createData))
  console.log('Full Shopify response:', JSON.stringify(createData, null, 2))
  
  // Handle both possible response formats
  let article
  if (createData.article) {
    article = createData.article
  } else if (createData.articles && createData.articles.length > 0) {
    article = createData.articles[0]
  } else {
    throw new Error(`Invalid Shopify response structure: ${JSON.stringify(createData)}`)
  }
  
  if (!article) {
    throw new Error(`No article found in response: ${JSON.stringify(createData)}`)
  }
  
  console.log(`Created article ${article.id} with handle: ${article.handle}`)
  console.log('Article details from Shopify:')
  console.log('  - Published:', article.published)
  console.log('  - Published At:', article.published_at)
  console.log('  - Template Suffix:', article.template_suffix)
  console.log('  - Author:', article.author)
  console.log('  - Tags:', article.tags)
  console.log('  - Image:', article.image ? JSON.stringify(article.image) : 'NONE')
  console.log('  - Featured Image (read-only):', article.featured_image || 'NONE')
  
  // Update or create sync status
  const postUrl = `${shopifyConfig.shopify_blog_url}/${article.handle}`
  
  if (existingSyncStatus) {
    await supabase
      .from('shopify_sync_status')
      .update({
        shopify_article_gid: article.id.toString(),
        shopify_handle: article.handle,
        post_url: postUrl,
        is_published: article.published_at !== null,
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
        is_published: article.published_at !== null,
        last_synced_at: new Date().toISOString()
      })
  }
  
  return {
    action: 'sync',
    article_id: article.id,
    handle: article.handle,
    url: postUrl,
    published: article.published_at !== null
  }
}

// FIXED: Enhanced updateArticle with article existence verification
async function updateArticle(task, articleData, syncStatus, shopifyConfig) {
  if (!syncStatus || !syncStatus.shopify_article_gid) {
    return await syncArticle(task, articleData, syncStatus, shopifyConfig)
  }
  
  const blogId = shopifyConfig.shopify_blog_id
  const shopifyDomain = shopifyConfig.shopify_domain
  const shopifyToken = shopifyConfig.shopify_access_token
  const apiVersion = shopifyConfig.shopify_api_version || '2023-10'
  const articleId = syncStatus.shopify_article_gid
  
  console.log(`Updating article ${articleId} in Shopify`)
  console.log('Update payload being sent:', JSON.stringify({
    ...articleData,
    body_html: articleData.body_html?.substring(0, 200) + '...', // Truncate for logging
    id: parseInt(articleId),
    published: true,
    published_at: new Date().toISOString()
  }, null, 2))
  console.log('Template suffix in update:', articleData.template_suffix || 'NONE')
  
  // FIXED: First, check if article exists
  const checkResponse = await fetch(
    `https://${shopifyDomain}/admin/api/${apiVersion}/blogs/${blogId}/articles/${articleId}.json`,
    {
      method: 'GET',
      headers: {
        [SHOPIFY_API_HEADER]: shopifyToken,
        'Content-Type': 'application/json',
      }
    }
  )
  
  if (checkResponse.status === 404) {
    console.log(`Article ${articleId} not found in Shopify, creating new one`)
    // Clear the sync status and create new article
    await clearSyncStatus(syncStatus.id, 'Article not found in Shopify, recreating')
    return await syncArticle(task, articleData, syncStatus, shopifyConfig)
  }
  
  if (!checkResponse.ok) {
    const errorText = await checkResponse.text()
    throw new Error(`Failed to verify article exists: ${errorText}`)
  }
  
  // Article exists, proceed with update
  // Check publish mode setting
  const publishMode = shopifyConfig.publish_mode || 'live'
  const isPublishLive = publishMode === 'live'
  
  console.log(`Update - Publish Mode: ${publishMode} (${isPublishLive ? 'Publishing Live' : 'Keeping as Draft'})`)
  
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
  console.log('Shopify update response:', JSON.stringify(updateData, null, 2))
  
  const article = updateData.article
  
  console.log(`Updated article ${article.id} with handle: ${article.handle}`)
  console.log('Updated article details:')
  console.log('  - Published:', article.published)
  console.log('  - Published At:', article.published_at)
  console.log('  - Template Suffix:', article.template_suffix)
  console.log('  - Author:', article.author)
  console.log('  - Image:', article.image ? JSON.stringify(article.image) : 'NONE')
  console.log('  - Featured Image (read-only):', article.featured_image || 'NONE')
  
  // Update sync status
  const postUrl = `${shopifyConfig.shopify_blog_url}/${article.handle}`
  
  await supabase
    .from('shopify_sync_status')
    .update({
      shopify_handle: article.handle,
      post_url: postUrl,
      is_published: article.published_at !== null,
      last_synced_at: new Date().toISOString(),
      sync_error: null
    })
    .eq('id', syncStatus.id)
  
  return {
    action: 'update',
    article_id: article.id,
    handle: article.handle,
    url: postUrl,
    published: article.published_at !== null
  }
}

async function publishArticle(task, publishStatus, syncStatus, shopifyConfig) {
  if (!syncStatus || !syncStatus.shopify_article_gid) {
    throw new Error('Cannot publish article that has not been synced')
  }
  
  // Verify article exists first
  const exists = await verifyArticleExists(syncStatus.shopify_article_gid, shopifyConfig)
  if (!exists) {
    throw new Error(`Article ${syncStatus.shopify_article_gid} not found in Shopify`)
  }
  
  const blogId = shopifyConfig.shopify_blog_id
  const shopifyDomain = shopifyConfig.shopify_domain
  const shopifyToken = shopifyConfig.shopify_access_token
  const apiVersion = shopifyConfig.shopify_api_version || '2023-10'
  const articleId = syncStatus.shopify_article_gid
  
  // Default to publish if not specified
  const shouldPublish = publishStatus !== false
  
  console.log(`${shouldPublish ? 'Publishing' : 'Unpublishing'} article ${articleId}`)
  
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
      is_published: article.published_at !== null,
      last_synced_at: new Date().toISOString(),
      sync_error: null
    })
    .eq('id', syncStatus.id)
  
  return {
    action: shouldPublish ? 'publish' : 'unpublish',
    article_id: article.id,
    is_published: article.published_at !== null
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
  
  console.log(`Deleting article ${articleId} from Shopify`)
  
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
  
  if (!deleteResponse.ok && deleteResponse.status !== 404) {
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

// ENHANCED: Generate hero image for task if not available
async function generateHeroImageForTask(contentPlanOutlineGuid, task) {
  try {
    console.log(`Generating hero image for outline: ${contentPlanOutlineGuid}`);
    console.log(`Task ${task.task_id} has hero_image_prompt: ${task.hero_image_prompt ? 'YES' : 'NO'}`);
    
    // If no hero_image_prompt, we can't generate an image
    if (!task.hero_image_prompt) {
      console.log('No hero_image_prompt found, cannot generate hero image');
      return null;
    }
    
    // Call the hero image generation function
    const response = await fetch(
      `${supabaseUrl}/functions/v1/generate-hero-image`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          guid: contentPlanOutlineGuid,
          regenerate: false
        })
      }
    );
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Hero image generation request failed: ${errorText}`);
      // Don't return here - still try polling in case it's processing
    } else {
      const result = await response.json();
      console.log(`Hero image generation initiated: ${JSON.stringify(result)}`);
    }
    
    // POLLING SOLUTION: Wait for the hero image to actually be generated
    console.log('Starting polling for hero image URL...');
    const maxAttempts = 20; // 20 attempts
    const waitTime = 3000; // 3 seconds between attempts
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      console.log(`Polling attempt ${attempt}/${maxAttempts}...`);
      
      // Wait before checking (except on first attempt)
      if (attempt > 1) {
        console.log(`Waiting ${waitTime/1000} seconds before checking...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
      
      // Query the database directly to check if hero_image_url is populated
      const { data: updatedTask, error: queryError } = await supabase
        .from('tasks')
        .select('hero_image_url, hero_image_status')
        .eq('task_id', task.task_id)
        .single();
      
      if (queryError) {
        console.error(`Error querying task: ${queryError.message}`);
        continue; // Try again
      }
      
      if (updatedTask && updatedTask.hero_image_url) {
        // Check if it's a valid URL (not a placeholder)
        const suspiciousPatterns = [
          /placeholder/i,
          /default/i,
          /stock/i,
          /unsplash/i,
          /pexels/i,
          /\/\d+\.\d+\.(jpg|png|jpeg)/i,  // URLs like "2.3.jpg"
          /sample/i,
          /temp/i,
          /dummy/i
        ];
        
        const isSuspicious = suspiciousPatterns.some(pattern => pattern.test(updatedTask.hero_image_url));
        
        if (!isSuspicious) {
          console.log(`✅ Hero image URL found after ${attempt} attempts: ${updatedTask.hero_image_url}`);
          console.log(`Hero image status: ${updatedTask.hero_image_status}`);
          return updatedTask.hero_image_url;
        } else {
          console.log(`⚠️ Found suspicious URL: ${updatedTask.hero_image_url}, continuing to wait...`);
        }
      } else {
        console.log(`No hero image URL yet, status: ${updatedTask?.hero_image_status || 'unknown'}`);
      }
    }
    
    // If we've exhausted all attempts, log the failure
    console.error(`❌ Failed to get hero image URL after ${maxAttempts} attempts (${maxAttempts * waitTime / 1000} seconds)`);
    console.log('Task details:');
    console.log(`  - Task ID: ${task.task_id}`);
    console.log(`  - Outline GUID: ${contentPlanOutlineGuid}`);
    console.log(`  - Had prompt: ${task.hero_image_prompt ? 'YES' : 'NO'}`);
    
    // One final check to see what state the task is in
    const { data: finalTask } = await supabase
      .from('tasks')
      .select('hero_image_status, hero_image_thinking')
      .eq('task_id', task.task_id)
      .single();
    
    if (finalTask) {
      console.log(`Final task status: ${finalTask.hero_image_status}`);
      if (finalTask.hero_image_thinking) {
        console.log(`Hero thinking: ${JSON.stringify(finalTask.hero_image_thinking)}`);
      }
    }
    
    return null;
    
  } catch (error) {
    console.error(`Error in generateHeroImageForTask: ${error.message}`);
    return null;
  }
}

// ENHANCED: Replace lead-image div with generated hero image
function replaceLeadImageWithHeroImage(bodyHtml, heroImageUrl, title) {
  try {
    // Look for div with class="lead-image" and replace the img inside it
    const leadImageRegex = /<div\s+class="lead-image"[^>]*>[\s\S]*?<img[^>]*src="[^"]*"[^>]*alt="[^"]*"[^>]*>[\s\S]*?<\/div>/gi
    
    // Create the replacement HTML with our hero image
    const replacementHtml = `<div class="lead-image">
        <img src="${heroImageUrl}" alt="${title}">
      </div>`
    
    // Replace the lead-image div if found
    if (leadImageRegex.test(bodyHtml)) {
      console.log('Found lead-image div, replacing with generated hero image')
      bodyHtml = bodyHtml.replace(leadImageRegex, replacementHtml)
    } else {
      console.log('No lead-image div found, adding hero image at the beginning')
      // If no lead-image div, add one at the beginning of the content
      bodyHtml = `${replacementHtml}\n\n${bodyHtml}`
    }
    
    return bodyHtml
  } catch (error) {
    console.error(`Error replacing lead image: ${error.message}`)
    return bodyHtml // Return original on error
  }
}