import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

/**
 * Helper functions to integrate webhook events into existing workflows
 */

export interface WebhookEventData {
  event: string;
  data: any;
  metadata?: {
    task_id?: string;
    job_id?: string;
    domain?: string;
    [key: string]: any;
  };
}

/**
 * Queue a webhook event to be processed asynchronously
 */
export async function queueWebhookEvent(
  supabase: any,
  event: string,
  data: any,
  domain?: string,
  metadata?: any
): Promise<void> {
  try {
    const { error } = await supabase
      .from('webhook_events_queue')
      .insert({
        event_type: event,
        payload: {
          ...data,
          metadata
        },
        domain,
        processed: false
      });

    if (error) {
      console.error("Failed to queue webhook event:", error);
    } else {
      console.log(`Queued webhook event: ${event} for domain: ${domain}`);
    }
  } catch (error) {
    console.error("Error queuing webhook event:", error);
  }
}

/**
 * Trigger webhook immediately (synchronous)
 */
export async function triggerWebhookEvent(
  event: string,
  data: any,
  domain?: string,
  metadata?: any
): Promise<void> {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const response = await fetch(
      `${supabaseUrl}/functions/v1/webhook-trigger`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseAnonKey}`
        },
        body: JSON.stringify({
          event,
          data,
          metadata: {
            ...metadata,
            domain
          }
        })
      }
    );

    if (!response.ok) {
      console.error(`Failed to trigger webhook: ${response.status}`);
    } else {
      console.log(`Triggered webhook event: ${event}`);
    }
  } catch (error) {
    console.error("Error triggering webhook event:", error);
  }
}

/**
 * Helper to extract domain from various sources
 */
export function extractDomain(
  url?: string,
  metadata?: any,
  customFields?: any
): string | undefined {
  // Try metadata first
  if (metadata?.domain) {
    return metadata.domain;
  }

  // Try custom fields
  if (customFields?.domain) {
    return customFields.domain;
  }

  // Try to extract from URL
  if (url) {
    try {
      const parsedUrl = new URL(url);
      return parsedUrl.hostname;
    } catch (error) {
      console.error("Failed to parse URL for domain:", error);
    }
  }

  return undefined;
}

/**
 * Notify webhook about task status change
 */
export async function notifyTaskStatusChange(
  supabase: any,
  taskId: string,
  status: string,
  data?: any
): Promise<void> {
  let event: string;

  switch (status) {
    case 'processing':
    case 'started':
      event = 'content_started';
      break;
    case 'completed':
    case 'complete':
      event = 'content_complete';
      break;
    case 'failed':
    case 'error':
      event = 'content_error';
      break;
    default:
      return; // Don't send webhooks for other statuses
  }

  // Get task details for domain
  const { data: task } = await supabase
    .from('tasks')
    .select('*')
    .eq('id', taskId)
    .single();

  if (!task) {
    console.error(`Task not found: ${taskId}`);
    return;
  }

  const domain = extractDomain(task.url, task.metadata, task.custom_fields);

  await queueWebhookEvent(
    supabase,
    event,
    {
      task_id: taskId,
      status,
      title: task.title,
      url: task.url,
      ...data
    },
    domain,
    {
      task_id: taskId,
      ...task.metadata
    }
  );
}

/**
 * Notify webhook about progress update
 */
export async function notifyProgressUpdate(
  supabase: any,
  taskId: string,
  progress: number,
  message?: string
): Promise<void> {
  // Get task details for domain
  const { data: task } = await supabase
    .from('tasks')
    .select('*')
    .eq('id', taskId)
    .single();

  if (!task) {
    console.error(`Task not found: ${taskId}`);
    return;
  }

  const domain = extractDomain(task.url, task.metadata, task.custom_fields);

  await queueWebhookEvent(
    supabase,
    'content_progress',
    {
      task_id: taskId,
      progress,
      message,
      status: task.status
    },
    domain,
    {
      task_id: taskId,
      ...task.metadata
    }
  );
}

/**
 * Notify webhook about outline generation
 */
export async function notifyOutlineGenerated(
  supabase: any,
  jobId: string,
  url: string,
  outline: any,
  metadata?: any
): Promise<void> {
  const domain = extractDomain(url, metadata);

  await queueWebhookEvent(
    supabase,
    'outline_generated',
    {
      job_id: jobId,
      url,
      outline,
      generated_at: new Date().toISOString()
    },
    domain,
    {
      job_id: jobId,
      ...metadata
    }
  );
}

/**
 * Notify webhook about research completion
 */
export async function notifyResearchComplete(
  supabase: any,
  taskId: string,
  researchData: any
): Promise<void> {
  // Get task details for domain
  const { data: task } = await supabase
    .from('tasks')
    .select('*')
    .eq('id', taskId)
    .single();

  if (!task) {
    console.error(`Task not found: ${taskId}`);
    return;
  }

  const domain = extractDomain(task.url, task.metadata, task.custom_fields);

  await queueWebhookEvent(
    supabase,
    'research_complete',
    {
      task_id: taskId,
      research_data: researchData,
      completed_at: new Date().toISOString()
    },
    domain,
    {
      task_id: taskId,
      ...task.metadata
    }
  );
}

/**
 * Notify webhook about draft completion
 */
export async function notifyDraftComplete(
  supabase: any,
  taskId: string,
  draftContent: any
): Promise<void> {
  // Get task details for domain
  const { data: task } = await supabase
    .from('tasks')
    .select('*')
    .eq('id', taskId)
    .single();

  if (!task) {
    console.error(`Task not found: ${taskId}`);
    return;
  }

  const domain = extractDomain(task.url, task.metadata, task.custom_fields);

  await queueWebhookEvent(
    supabase,
    'draft_complete',
    {
      task_id: taskId,
      draft_content: draftContent,
      word_count: draftContent?.length || 0,
      completed_at: new Date().toISOString()
    },
    domain,
    {
      task_id: taskId,
      ...task.metadata
    }
  );
}

/**
 * Notify webhook about QA completion
 */
export async function notifyQAComplete(
  supabase: any,
  taskId: string,
  qaResults: any,
  finalContent?: any
): Promise<void> {
  // Get task details for domain
  const { data: task } = await supabase
    .from('tasks')
    .select('*')
    .eq('id', taskId)
    .single();

  if (!task) {
    console.error(`Task not found: ${taskId}`);
    return;
  }

  const domain = extractDomain(task.url, task.metadata, task.custom_fields);

  await queueWebhookEvent(
    supabase,
    'qa_complete',
    {
      task_id: taskId,
      qa_results: qaResults,
      final_content: finalContent,
      completed_at: new Date().toISOString()
    },
    domain,
    {
      task_id: taskId,
      ...task.metadata
    }
  );
}