// Supabase Edge Function: shopify-webhook-handler
// Description: Handler for Shopify webhooks to update sync status

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { createHmac } from "https://deno.land/std@0.168.0/crypto/mod.ts"

// Initialize Supabase client
const supabaseUrl = Deno.env.get('PROJECT_URL') || ''
const supabaseKey = Deno.env.get('SERVICE_ROLE_KEY') || ''
const supabase = createClient(supabaseUrl, supabaseKey)

// Main handler function
serve(async (req) => {
  try {
    // Verify Shopify webhook
    const shopifyHmac = req.headers.get('X-Shopify-Hmac-Sha256')
    const shopifyTopic = req.headers.get('X-Shopify-Topic')
    const shopifyShop = req.headers.get('X-Shopify-Shop-Domain')
    
    if (!shopifyHmac) {
      return new Response(
        JSON.stringify({ error: 'Missing X-Shopify-Hmac-Sha256 header' }),
        { 
          status: 401,
          headers: { "Content-Type": "application/json" } 
        }
      )
    }
    
    if (!shopifyTopic) {
      return new Response(
        JSON.stringify({ error: 'Missing X-Shopify-Topic header' }),
        { 
          status: 400,
          headers: { "Content-Type": "application/json" } 
        }
      )
    }
    
    if (!shopifyShop) {
      return new Response(
        JSON.stringify({ error: 'Missing X-Shopify-Shop-Domain header' }),
        { 
          status: 400,
          headers: { "Content-Type": "application/json" } 
        }
      )
    }
    
    // Get the Shopify webhook secret for this shop
    const { data: shopifyConfig, error: configError } = await supabase
      .from('shopify_configs')
      .select('id, shopify_webhook_secret')
      .eq('shopify_domain', shopifyShop)
      .maybeSingle()
    
    if (configError || !shopifyConfig || !shopifyConfig.shopify_webhook_secret) {
      console.error(`Shop not found or missing webhook secret: ${shopifyShop}`)
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { 
          status: 401,
          headers: { "Content-Type": "application/json" } 
        }
      )
    }
    
    // Get request body as text for HMAC verification
    const body = await req.text()
    
    // Verify HMAC signature
    const isValid = await verifyShopifyHmac(
      body,
      shopifyHmac,
      shopifyConfig.shopify_webhook_secret
    )
    
    if (!isValid) {
      console.error('Invalid webhook signature')
      return new Response(
        JSON.stringify({ error: 'Invalid signature' }),
        { 
          status: 401,
          headers: { "Content-Type": "application/json" } 
        }
      )
    }
    
    // Process the webhook based on topic
    const parsedBody = JSON.parse(body)
    
    if (shopifyTopic === 'articles/create' || shopifyTopic === 'articles/update') {
      await handleArticleUpdate(parsedBody, shopifyShop)
    } else if (shopifyTopic === 'articles/delete') {
      await handleArticleDelete(parsedBody, shopifyShop)
    } else if (shopifyTopic === 'articles/publish' || shopifyTopic === 'articles/unpublish') {
      await handleArticlePublishStateChange(parsedBody, shopifyTopic, shopifyShop)
    } else {
      console.log(`Ignoring unsupported webhook topic: ${shopifyTopic}`)
    }
    
    // Return success response
    return new Response(
      JSON.stringify({ success: true }),
      { 
        status: 200,
        headers: { "Content-Type": "application/json" } 
      }
    )
    
  } catch (error) {
    console.error("Error in shopify-webhook-handler:", error)
    
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500,
        headers: { "Content-Type": "application/json" } 
      }
    )
  }
})

async function verifyShopifyHmac(body, hmac, secret) {
  try {
    // Convert the webhook secret to a Uint8Array
    const encoder = new TextEncoder()
    const key = encoder.encode(secret)
    const message = encoder.encode(body)
    
    // Create HMAC using SHA-256
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      key,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )
    
    // Sign the message
    const signature = await crypto.subtle.sign(
      'HMAC',
      cryptoKey,
      message
    )
    
    // Convert to base64
    const calculated = btoa(
      String.fromCharCode(...new Uint8Array(signature))
    )
    
    // Compare signatures
    return hmac === calculated
  } catch (error) {
    console.error('Error verifying HMAC:', error)
    return false
  }
}

async function handleArticleUpdate(article, shopDomain) {
  try {
    // Find the sync status record by Shopify article ID
    const { data: syncStatus, error: syncError } = await supabase
      .from('shopify_sync_status')
      .select('*')
      .eq('shopify_article_gid', article.id.toString())
      .maybeSingle()
    
    if (syncError) {
      console.error(`Error finding sync status for article ${article.id}:`, syncError)
      return
    }
    
    if (!syncStatus) {
      console.log(`No sync status found for article ${article.id}, may be created outside of system`)
      return
    }
    
    // Update the sync status
    await supabase
      .from('shopify_sync_status')
      .update({
        shopify_handle: article.handle,
        is_published: article.published,
        last_synced_at: new Date().toISOString(),
        sync_error: null
      })
      .eq('id', syncStatus.id)
    
    console.log(`Updated sync status for article ${article.id}`)
  } catch (error) {
    console.error(`Error handling article update for ${article.id}:`, error)
  }
}

async function handleArticleDelete(article, shopDomain) {
  try {
    // Find the sync status record by Shopify article ID
    const { data: syncStatus, error: syncError } = await supabase
      .from('shopify_sync_status')
      .select('*')
      .eq('shopify_article_gid', article.id.toString())
      .maybeSingle()
    
    if (syncError) {
      console.error(`Error finding sync status for article ${article.id}:`, syncError)
      return
    }
    
    if (!syncStatus) {
      console.log(`No sync status found for article ${article.id}, may be created outside of system`)
      return
    }
    
    // Delete the sync status
    await supabase
      .from('shopify_sync_status')
      .delete()
      .eq('id', syncStatus.id)
    
    console.log(`Removed sync status for deleted article ${article.id}`)
  } catch (error) {
    console.error(`Error handling article delete for ${article.id}:`, error)
  }
}

async function handleArticlePublishStateChange(article, topic, shopDomain) {
  try {
    const isPublished = topic === 'articles/publish'
    
    // Find the sync status record by Shopify article ID
    const { data: syncStatus, error: syncError } = await supabase
      .from('shopify_sync_status')
      .select('*')
      .eq('shopify_article_gid', article.id.toString())
      .maybeSingle()
    
    if (syncError) {
      console.error(`Error finding sync status for article ${article.id}:`, syncError)
      return
    }
    
    if (!syncStatus) {
      console.log(`No sync status found for article ${article.id}, may be created outside of system`)
      return
    }
    
    // Update the sync status
    await supabase
      .from('shopify_sync_status')
      .update({
        is_published: isPublished,
        last_synced_at: new Date().toISOString(),
        sync_error: null
      })
      .eq('id', syncStatus.id)
    
    console.log(`Updated publish status for article ${article.id} to ${isPublished}`)
  } catch (error) {
    console.error(`Error handling publish state change for ${article.id}:`, error)
  }
}