import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import * as crypto from "https://deno.land/std@0.168.0/crypto/mod.ts";

export interface WebhookPayload {
  event: string;
  timestamp: string;
  data: any;
  metadata?: {
    task_id?: string;
    job_id?: string;
    domain?: string;
    [key: string]: any;
  };
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
 */
export async function generateWebhookSignature(
  payload: string,
  secret: string
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payload)
  );

  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

/**
 * Send webhook notification to registered endpoint
 */
export async function sendWebhook(
  webhook: WebhookConfig,
  event: string,
  data: any,
  metadata?: any
): Promise<{ success: boolean; error?: string; statusCode?: number }> {
  try {
    const payload: WebhookPayload = {
      event,
      timestamp: new Date().toISOString(),
      data,
      metadata
    };

    const payloadString = JSON.stringify(payload);
    const signature = await generateWebhookSignature(payloadString, webhook.secret);

    const response = await fetch(webhook.webhook_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Signature": signature,
        "X-Webhook-Event": event,
        "X-Webhook-ID": webhook.id,
        "X-Webhook-Timestamp": payload.timestamp
      },
      body: payloadString
    });

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
        statusCode: response.status
      };
    }

    return { success: true, statusCode: response.status };
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
    console.error("Error fetching webhooks:", error);
    return [];
  }

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
 * Send webhooks for a specific event with retry logic
 */
export async function triggerWebhooks(
  supabase: any,
  event: string,
  data: any,
  metadata?: any
): Promise<void> {
  const domain = metadata?.domain;
  const webhooks = await getWebhooksForEvent(supabase, event, domain);

  if (webhooks.length === 0) {
    console.log(`No active webhooks found for event: ${event}`);
    return;
  }

  console.log(`Triggering ${webhooks.length} webhooks for event: ${event}`);

  // Send webhooks in parallel
  await Promise.all(
    webhooks.map(async (webhook) => {
      const result = await sendWebhook(webhook, event, data, metadata);

      // Log the event
      await logWebhookEvent(
        supabase,
        webhook.id,
        event,
        { data, metadata },
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