// Supabase Edge Function: update-shopify-article
// Description: Update specific properties of a Shopify article

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// Initialize Supabase client
const supabaseUrl = Deno.env.get('PROJECT_URL') || ''
const supabaseKey = Deno.env.get('SERVICE_ROLE_KEY') || ''
const supabase = createClient(supabaseUrl, supabaseKey)

// Shopify API constants
const SHOPIFY_API_HEADER = "X-Shopify-Access-Token"

serve(async (req) => {
  try {
    // Parse request body
    const body = await req.json()
    const { 
      article_id, 
      client_id,
      updates = {} 
    } = body

    if (!article_id) {
      throw new Error('article_id is required')
    }

    if (!client_id) {
      throw new Error('client_id is required')
    }

    // Get client's Shopify config
    const { data: shopifyConfig, error: configError } = await supabase
      .from('shopify_configs')
      .select('*')
      .eq('client_id', client_id)
      .single()
    
    if (configError) {
      throw new Error(`Error fetching Shopify config: ${configError.message}`)
    }
    
    if (!shopifyConfig) {
      throw new Error(`Shopify config not found for client: ${client_id}`)
    }

    const blogId = shopifyConfig.shopify_blog_id
    const shopifyDomain = shopifyConfig.shopify_domain
    const shopifyToken = shopifyConfig.shopify_access_token
    const apiVersion = shopifyConfig.shopify_api_version || '2023-10'

    console.log(`Updating article ${article_id} for client ${client_id}`)
    console.log('Updates to apply:', JSON.stringify(updates, null, 2))

    // First, get the current article to verify it exists
    const checkResponse = await fetch(
      `https://${shopifyDomain}/admin/api/${apiVersion}/blogs/${blogId}/articles/${article_id}.json`,
      {
        method: 'GET',
        headers: {
          [SHOPIFY_API_HEADER]: shopifyToken,
          'Content-Type': 'application/json',
        }
      }
    )

    if (!checkResponse.ok) {
      const errorText = await checkResponse.text()
      throw new Error(`Failed to fetch article: ${errorText}`)
    }

    const currentData = await checkResponse.json()
    const currentArticle = currentData.article

    console.log('Current article state:')
    console.log('  - Title:', currentArticle.title)
    console.log('  - Template Suffix:', currentArticle.template_suffix || 'NONE')
    console.log('  - Published:', currentArticle.published)
    console.log('  - Author:', currentArticle.author)

    // Apply updates
    const updatePayload = {
      article: {
        id: parseInt(article_id),
        ...updates
      }
    }

    console.log('Sending update payload:', JSON.stringify(updatePayload, null, 2))

    // Update the article
    const updateResponse = await fetch(
      `https://${shopifyDomain}/admin/api/${apiVersion}/blogs/${blogId}/articles/${article_id}.json`,
      {
        method: 'PUT',
        headers: {
          [SHOPIFY_API_HEADER]: shopifyToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updatePayload)
      }
    )

    if (!updateResponse.ok) {
      const errorText = await updateResponse.text()
      throw new Error(`Failed to update article: ${errorText}`)
    }

    const updateData = await updateResponse.json()
    const updatedArticle = updateData.article

    console.log('Updated article state:')
    console.log('  - Title:', updatedArticle.title)
    console.log('  - Template Suffix:', updatedArticle.template_suffix || 'NONE')
    console.log('  - Published:', updatedArticle.published)
    console.log('  - Author:', updatedArticle.author)

    // Return the update result
    return new Response(
      JSON.stringify({ 
        success: true,
        article_id: updatedArticle.id,
        handle: updatedArticle.handle,
        updates_applied: updates,
        before: {
          template_suffix: currentArticle.template_suffix,
          published: currentArticle.published,
          author: currentArticle.author
        },
        after: {
          template_suffix: updatedArticle.template_suffix,
          published: updatedArticle.published,
          author: updatedArticle.author
        },
        url: `https://${shopifyDomain}${updatedArticle.path || `/blogs/news/${updatedArticle.handle}`}`
      }),
      { 
        status: 200,
        headers: { "Content-Type": "application/json" } 
      }
    )

  } catch (error) {
    console.error("Error in update-shopify-article:", error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500,
        headers: { "Content-Type": "application/json" } 
      }
    )
  }
})