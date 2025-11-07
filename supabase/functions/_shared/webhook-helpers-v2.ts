import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

export interface CentrWebhookPayload {
  guid: string;  // GUID at the top (will be task_id)
  event: string;
  timestamp: string;
  signature?: string;  // Optional signature at top level (per Erik's request)
  data: {
    status: string;
    title: string;
    slug: string;
    client_domain: string;
    html_link?: string;
    google_doc_link?: string;
    content?: string;
    seo_keyword?: string;
    meta_description?: string;
    hero_image_url?: string;
    error?: string;
    live_post_url?: string;
    progress?: number;
  };
  // Note: signature is sent in BOTH X-Webhook-Signature header AND in body
}

export interface WebhookConfig {
  id: string;
  webhook_url: string;
  secret: string;
  events: string[];
  email: string;
}

/**
 * Generate HMAC signature for webhook payload verification
 * Per Centr spec: sha256=<hex_encoded_hash>
 * Signs the full JSON request body as a compact string
 */
export async function generateWebhookSignature(
  payload: string,
  secret: string
): Promise<string> {
  const encoder = new TextEncoder();
  
  // Use the global Web Crypto API (available in Deno)
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await globalThis.crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payload)
  );

  // Convert to hex string as per Centr spec
  const hashArray = Array.from(new Uint8Array(signature));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  // Return with sha256= prefix as required by Centr
  return `sha256=${hashHex}`;
}

/**
 * Generate slug from title
 */
function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

/**
 * Send webhook notification to registered endpoint with Centr format
 */
export async function sendCentrWebhook(
  webhook: WebhookConfig,
  event: string,
  data: any,
  guid?: string
): Promise<{ success: boolean; error?: string; statusCode?: number; payload?: any }> {
  try {
    // Use task_id as the GUID
    const eventGuid = data.task_id || guid || globalThis.crypto.randomUUID();

    // If there's HTML content, upload it to Supabase Storage and use the URL instead
    let contentUrl = data.html_link;
    
    if (data.content && data.content.length > 1000) {
      console.log(`[sendCentrWebhook] Uploading HTML to storage (${data.content.length} bytes)...`);
      
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
        
        if (supabaseUrl && supabaseServiceKey) {
          const supabaseClient = createClient(supabaseUrl, supabaseServiceKey);
          
          // Upload HTML to storage: /blogs/centr.com/{guid}.html
          const fileName = `${eventGuid}.html`;
          const filePath = `centr.com/${fileName}`;
          
          const { data: uploadData, error: uploadError } = await supabaseClient
            .storage
            .from('blogs')
            .upload(filePath, data.content, {
              contentType: 'text/html',
              upsert: true
            });
          
          if (uploadError) {
            console.error(`[sendCentrWebhook] Storage upload error:`, uploadError);
          } else {
            // Generate public URL
            const { data: { publicUrl } } = supabaseClient
              .storage
              .from('blogs')
              .getPublicUrl(filePath);
            
            contentUrl = publicUrl;
            console.log(`[sendCentrWebhook] HTML uploaded to: ${publicUrl}`);
          }
        }
      } catch (storageError) {
        console.error(`[sendCentrWebhook] Storage error:`, storageError);
        // Continue with original content if storage fails
      }
    }

    // Prepare Centr-formatted payload - guid at top level
    const payloadWithoutSignature = {
      guid: eventGuid,  // GUID at the top
      event,
      timestamp: new Date().toISOString(),
      data: {
        status: data.status || 'Unknown',
        title: data.title || '',
        slug: data.slug || generateSlug(data.title || ''),
        client_domain: data.client_domain || data.domain || '',
        html_link: contentUrl,  // Use storage URL instead of inline HTML
        google_doc_link: data.google_doc_link,
        content: contentUrl ? undefined : data.content,  // Only include content if no URL
        seo_keyword: data.seo_keyword || data.primary_keyword,
        meta_description: data.meta_description,
        hero_image_url: data.hero_image_url,
        error: data.error,
        live_post_url: data.live_post_url
      }
    };

    // Generate signature from payload WITHOUT signature field
    const payloadStringForSigning = JSON.stringify(payloadWithoutSignature);
    const signature = await generateWebhookSignature(payloadStringForSigning, webhook.secret);

    // Now add signature to the payload at top level (per Erik's request)
    const payloadWithSignature = {
      ...payloadWithoutSignature,
      signature: signature  // Add signature at top level
    };

    const finalPayloadString = JSON.stringify(payloadWithSignature);

    // Debug logging
    console.log(`[sendCentrWebhook] Sending to: ${webhook.webhook_url}`);
    console.log(`[sendCentrWebhook] Payload length: ${finalPayloadString.length} chars`);
    console.log(`[sendCentrWebhook] Payload preview: ${finalPayloadString.substring(0, 200)}...`);
    console.log(`[sendCentrWebhook] Signature: ${signature}`);
    console.log(`[sendCentrWebhook] Secret (first 10 chars): ${webhook.secret.substring(0, 10)}...`);
    console.log(`[sendCentrWebhook] NOTE: Signature included BOTH in header AND in payload body`);

    // Send webhook - signature in BOTH header AND body (per Erik's request)
    // Note: API key is already in the webhook URL as a query parameter (e.g., ?code=sk_xxx)
    const response = await fetch(webhook.webhook_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Signature": signature,
        "X-Webhook-Event": event,
        "X-Webhook-ID": webhook.id,
        "X-Webhook-GUID": eventGuid,
        "X-Webhook-Timestamp": payloadWithoutSignature.timestamp
      },
      body: finalPayloadString  // Send payload WITH signature in body
    });

    console.log(`[sendCentrWebhook] Response status: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      // Try to get error body for debugging
      let errorBody = '';
      try {
        errorBody = await response.text();
        console.log(`[sendCentrWebhook] Error response body: ${errorBody}`);
      } catch (e) {
        console.log(`[sendCentrWebhook] Could not read error body`);
      }
      
      return {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
        statusCode: response.status,
        payload: payloadWithSignature  // Include payload even on error for logging
      };
    }

    return { success: true, statusCode: response.status, payload: payloadWithSignature };
  } catch (error) {
    return {
      success: false,
      error: error.message || "Unknown error occurred"
    };
  }
}

/**
 * Get all active webhooks for a specific event and domain
 */
export async function getWebhooksForEvent(
  supabase: any,
  event: string,
  domain?: string
): Promise<WebhookConfig[]> {
  console.log(`[getWebhooksForEvent] Looking for event: ${event}, domain: ${domain}`);
  
  let query = supabase
    .from("webhooks")
    .select(`
      id,
      webhook_url,
      secret,
      events,
      email,
      api_key_domain_id,
      domain
    `)
    .eq("is_active", true)
    .contains("events", [event]);

  if (domain) {
    query = query.eq("domain", domain);
  }

  const { data, error } = await query;

  if (error) {
    console.error("[getWebhooksForEvent] Error fetching webhooks:", error);
    return [];
  }

  console.log(`[getWebhooksForEvent] Found ${data?.length || 0} webhooks for event: ${event}, domain: ${domain}`);
  
  return data || [];
}

/**
 * Log webhook event for tracking and retry purposes
 */
export async function logWebhookEvent(
  supabase: any,
  webhookId: string,
  eventType: string,
  payload: any,
  status: string,
  responseStatus?: number,
  responseBody?: string
): Promise<void> {
  const { error } = await supabase
    .from("webhook_events")
    .insert({
      webhook_id: webhookId,
      event_type: eventType,
      payload,
      status,
      response_status: responseStatus,
      response_body: responseBody,
      delivered_at: status === "delivered" ? new Date().toISOString() : null,
      next_retry_at: status === "failed" ? calculateNextRetryTime() : null
    });

  if (error) {
    console.error("Error logging webhook event:", error);
  }
}

/**
 * Calculate next retry time using exponential backoff
 */
function calculateNextRetryTime(attemptCount: number = 0): string {
  const baseDelay = 60; // 1 minute
  const maxDelay = 3600; // 1 hour
  const delay = Math.min(baseDelay * Math.pow(2, attemptCount), maxDelay);

  const nextRetry = new Date();
  nextRetry.setSeconds(nextRetry.getSeconds() + delay);
  return nextRetry.toISOString();
}

/**
 * Update webhook statistics after delivery attempt
 */
export async function updateWebhookStats(
  supabase: any,
  webhookId: string,
  success: boolean,
  failureReason?: string
): Promise<void> {
  const updates: any = {
    last_called_at: new Date().toISOString()
  };

  if (success) {
    updates.last_success_at = new Date().toISOString();
    updates.failure_count = 0;
  } else {
    updates.last_failure_at = new Date().toISOString();
    updates.last_failure_reason = failureReason;

    // Increment failure count
    const { data } = await supabase
      .from("webhooks")
      .select("failure_count")
      .eq("id", webhookId)
      .single();

    updates.failure_count = (data?.failure_count || 0) + 1;

    // Disable webhook after 5 consecutive failures
    if (updates.failure_count >= 5) {
      updates.is_active = false;
      console.log(`Webhook ${webhookId} disabled after ${updates.failure_count} failures`);
    }
  }

  const { error } = await supabase
    .from("webhooks")
    .update(updates)
    .eq("id", webhookId);

  if (error) {
    console.error("Error updating webhook stats:", error);
  }
}

/**
 * Send webhooks for a specific event with Centr format
 */
export async function triggerCentrWebhooks(
  supabase: any,
  event: string,
  data: any,
  guid?: string
): Promise<void> {
  const domain = data.client_domain || data.domain;
  console.log(`[triggerCentrWebhooks] Event: ${event}, Domain: ${domain}, Data keys:`, Object.keys(data));
  
  const webhooks = await getWebhooksForEvent(supabase, event, domain);

  if (webhooks.length === 0) {
    console.log(`No active webhooks found for event: ${event}, domain: ${domain}`);
    console.log(`Available data:`, { client_domain: data.client_domain, domain: data.domain });
    return;
  }

  console.log(`Triggering ${webhooks.length} webhooks for event: ${event}`);

  // Send webhooks in parallel
  await Promise.all(
    webhooks.map(async (webhook) => {
      const result = await sendCentrWebhook(webhook, event, data, guid);

      // Log the event with the actual formatted payload that was sent
      await logWebhookEvent(
        supabase,
        webhook.id,
        event,
        result.payload || data,  // Use formatted payload if available, fallback to data
        result.success ? "delivered" : "failed",
        result.statusCode,
        result.error
      );

      // Update webhook statistics
      await updateWebhookStats(
        supabase,
        webhook.id,
        result.success,
        result.error
      );

      if (result.success) {
        console.log(`✅ Webhook delivered to ${webhook.webhook_url}`);
      } else {
        console.error(`❌ Webhook failed for ${webhook.webhook_url}: ${result.error}`);
      }
    })
  );
}

/**
 * Validate webhook URL format and protocol
 */
export function validateWebhookUrl(url: string): { valid: boolean; error?: string } {
  try {
    const parsedUrl = new URL(url);

    if (!parsedUrl.protocol.startsWith("https")) {
      return { valid: false, error: "Webhook URL must use HTTPS protocol" };
    }

    if (parsedUrl.hostname === "localhost" || parsedUrl.hostname === "127.0.0.1") {
      return { valid: false, error: "Webhook URL cannot point to localhost" };
    }

    return { valid: true };
  } catch (error) {
    return { valid: false, error: "Invalid URL format" };
  }
}

/**
 * Extract domain from URL for validation
 */
export function extractDomain(url: string): string | null {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.hostname;
  } catch (error) {
    return null;
  }
}