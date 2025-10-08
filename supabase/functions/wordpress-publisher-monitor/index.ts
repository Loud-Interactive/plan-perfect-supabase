// Content Perfect WordPress Publishing Monitor
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import axiod from "https://deno.land/x/axiod@0.26.2/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Create Supabase client
const supabaseClient = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);

// Alert thresholds
const ALERT_THRESHOLDS = {
  TASK_FAILURE_COUNT: 3,
  DOMAIN_FAILURE_COUNT: 5,
  DOMAIN_FAILURE_PERCENTAGE: 50,
  OLD_TASK_HOURS: 24
};

// Optional webhook URL for alerts
const ALERT_WEBHOOK_URL = Deno.env.get("ALERT_WEBHOOK_URL");

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Monitor system and generate alerts
    const alerts = await monitorPublishingSystem();
    
    // Send alerts if webhook configured
    if (ALERT_WEBHOOK_URL && alerts.length > 0) {
      await sendAlerts(alerts);
    }
    
    // Return monitoring results
    return new Response(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        alerts: alerts,
        stats: await getSystemStats()
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error monitoring publishing system:", error);

    return new Response(
      JSON.stringify({
        error: "Error monitoring publishing system",
        details: error.message,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

/**
 * Monitor publishing system for issues
 */
async function monitorPublishingSystem() {
  const alerts = [];
  
  // Check for repeatedly failed tasks
  const failedTasks = await checkRepeatedTaskFailures();
  alerts.push(...failedTasks);
  
  // Check for domains with high failure rates
  const failedDomains = await checkDomainFailures();
  alerts.push(...failedDomains);
  
  // Check for old completed tasks that haven't been published
  const oldTasks = await checkOldUnpublishedTasks();
  alerts.push(...oldTasks);
  
  // Check for expired API keys still in use
  const expiredKeys = await checkExpiredApiKeys();
  alerts.push(...expiredKeys);
  
  return alerts;
}

/**
 * Check for tasks with repeated failures
 */
async function checkRepeatedTaskFailures() {
  const alerts = [];
  
  // Get tasks with multiple failures in last 24 hours
  const { data, error } = await supabaseClient
    .from("publication_logs")
    .select(`
      task_id,
      count(*),
      tasks:task_id (
        title,
        client_domain
      )
    `)
    .eq("status", "error")
    .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .is("tasks.live_post_url", null)
    .group("task_id, tasks.title, tasks.client_domain")
    .having("count(*)", ">=", ALERT_THRESHOLDS.TASK_FAILURE_COUNT);
  
  if (error) {
    console.error("Error checking for repeated task failures:", error);
    return alerts;
  }
  
  // Create alert for each failing task
  for (const task of data) {
    alerts.push({
      type: "repeated_task_failures",
      severity: "warning",
      message: `Task "${task.tasks.title}" (${task.task_id}) has failed publication ${task.count} times for ${task.tasks.client_domain}`,
      details: {
        task_id: task.task_id,
        title: task.tasks.title,
        domain: task.tasks.client_domain,
        failure_count: task.count
      }
    });
  }
  
  return alerts;
}

/**
 * Check for domains with high failure rates
 */
async function checkDomainFailures() {
  const alerts = [];
  
  // Get domains with multiple failures in last 24 hours
  const { data, error } = await supabaseClient
    .from("publication_logs")
    .select(`
      tasks:task_id (
        client_domain
      ),
      status,
      count(*)
    `)
    .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .group("tasks.client_domain, status");
  
  if (error) {
    console.error("Error checking for domain failures:", error);
    return alerts;
  }
  
  // Aggregate counts by domain
  const domainStats = {};
  for (const row of data) {
    const domain = row.tasks.client_domain;
    if (!domain) continue;
    
    if (!domainStats[domain]) {
      domainStats[domain] = { total: 0, failures: 0 };
    }
    
    domainStats[domain].total += row.count;
    if (row.status === "error") {
      domainStats[domain].failures += row.count;
    }
  }
  
  // Check for domains with high failure counts or rates
  for (const [domain, stats] of Object.entries(domainStats)) {
    if (stats.failures >= ALERT_THRESHOLDS.DOMAIN_FAILURE_COUNT) {
      // High absolute number of failures
      alerts.push({
        type: "domain_failure_count",
        severity: "warning",
        message: `Domain ${domain} has ${stats.failures} publication failures in the last 24 hours`,
        details: {
          domain: domain,
          failure_count: stats.failures,
          total_attempts: stats.total
        }
      });
    } else if (stats.total >= 5 && (stats.failures / stats.total * 100) >= ALERT_THRESHOLDS.DOMAIN_FAILURE_PERCENTAGE) {
      // High percentage of failures (with minimum sample size)
      alerts.push({
        type: "domain_failure_rate",
        severity: "warning",
        message: `Domain ${domain} has ${Math.round(stats.failures / stats.total * 100)}% publication failure rate in the last 24 hours (${stats.failures}/${stats.total})`,
        details: {
          domain: domain,
          failure_count: stats.failures,
          total_attempts: stats.total,
          failure_rate: stats.failures / stats.total
        }
      });
    }
  }
  
  return alerts;
}

/**
 * Check for old completed tasks that haven't been published
 */
async function checkOldUnpublishedTasks() {
  const alerts = [];
  
  // Get old completed tasks without live_post_url
  const { data, error } = await supabaseClient
    .from("tasks")
    .select(`
      task_id,
      title,
      client_domain,
      created_at,
      status
    `)
    .eq("status", "Complete")
    .is("live_post_url", null)
    .lt("created_at", new Date(Date.now() - ALERT_THRESHOLDS.OLD_TASK_HOURS * 60 * 60 * 1000).toISOString())
    .limit(10);
  
  if (error) {
    console.error("Error checking for old unpublished tasks:", error);
    return alerts;
  }
  
  // If we have old unpublished tasks, create an alert
  if (data.length > 0) {
    alerts.push({
      type: "old_unpublished_tasks",
      severity: "info",
      message: `${data.length} completed tasks older than ${ALERT_THRESHOLDS.OLD_TASK_HOURS} hours haven't been published`,
      details: {
        count: data.length,
        sample_tasks: data.map(task => ({
          task_id: task.task_id,
          title: task.title,
          domain: task.client_domain,
          created_at: task.created_at
        }))
      }
    });
  }
  
  return alerts;
}

/**
 * Check for expired API keys that were used after expiration
 */
async function checkExpiredApiKeys() {
  const alerts = [];
  
  // Get API keys that were used after expiration
  const { data, error } = await supabaseClient
    .from("client_api_keys")
    .select(`
      id,
      domain,
      expires_at,
      last_used,
      client_id,
      clients:client_id (
        name
      )
    `)
    .lt("expires_at", new Date().toISOString())
    .gt("last_used", "expires_at");
  
  if (error) {
    console.error("Error checking for expired API keys:", error);
    return alerts;
  }
  
  // Create alert for each expired key that was used
  for (const key of data) {
    alerts.push({
      type: "expired_api_key_used",
      severity: "error",
      message: `Expired API key for ${key.domain} (client: ${key.clients?.name}) was used after expiration`,
      details: {
        key_id: key.id,
        domain: key.domain,
        client_id: key.client_id,
        client_name: key.clients?.name,
        expired_at: key.expires_at,
        last_used: key.last_used
      }
    });
  }
  
  return alerts;
}

/**
 * Get general system statistics
 */
async function getSystemStats() {
  // Get counts of various task statuses
  const { data: taskStats, error: taskError } = await supabaseClient
    .from("tasks")
    .select(`
      status,
      count(*)
    `)
    .is("live_post_url", null)
    .group("status");
  
  if (taskError) {
    console.error("Error getting task statistics:", taskError);
    return {};
  }
  
  // Get publication logs statistics for last 24 hours
  const { data: pubStats, error: pubError } = await supabaseClient
    .from("publication_logs")
    .select(`
      status,
      count(*)
    `)
    .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .group("status");
  
  if (pubError) {
    console.error("Error getting publication statistics:", pubError);
    return {};
  }
  
  // Get retry queue count
  const { count: retryCount, error: retryError } = await supabaseClient
    .from("publication_retries")
    .select("*", { count: "exact", head: true });
  
  if (retryError) {
    console.error("Error getting retry queue count:", retryError);
    return {};
  }
  
  // Get active domains count
  const { data: domains, error: domainError } = await supabaseClient
    .from("client_api_keys")
    .select("domain")
    .eq("is_active", true)
    .is("expires_at", null);
  
  if (domainError) {
    console.error("Error getting active domains:", domainError);
    return {};
  }
  
  // Format the task statistics
  const taskStatsByStatus = {};
  for (const stat of taskStats) {
    taskStatsByStatus[stat.status] = stat.count;
  }
  
  // Format the publication statistics
  const pubStatsByStatus = {};
  for (const stat of pubStats) {
    pubStatsByStatus[stat.status] = stat.count;
  }
  
  // Get count of unique domains
  const uniqueDomains = new Set(domains.map(d => d.domain));
  
  return {
    unpublished_tasks: taskStatsByStatus,
    publications_24h: pubStatsByStatus,
    retry_queue_size: retryCount || 0,
    active_domains: uniqueDomains.size
  };
}

/**
 * Send alerts to webhook
 */
async function sendAlerts(alerts) {
  if (!ALERT_WEBHOOK_URL) return;
  
  try {
    // Filter alerts to only send significant ones
    const significantAlerts = alerts.filter(alert => 
      alert.severity === "error" || alert.severity === "warning"
    );
    
    if (significantAlerts.length === 0) return;
    
    // Format message for webhook
    const message = {
      text: `⚠️ WordPress Publishing Alerts (${new Date().toISOString()})`,
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: `⚠️ WordPress Publishing Alerts`,
            emoji: true
          }
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${significantAlerts.length} alerts detected*`
          }
        },
        ...significantAlerts.map(alert => ({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${alert.severity.toUpperCase()}: ${alert.type}*\n${alert.message}`
          }
        }))
      ]
    };
    
    // Send to webhook
    await axiod.post(ALERT_WEBHOOK_URL, message, {
      headers: {
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("Error sending alerts to webhook:", error);
  }
}