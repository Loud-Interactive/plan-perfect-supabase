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
    // Extract task_id from data to use as the webhook event id
    // This ensures we can upsert (update or insert) safely
    const taskId = data?.task_id || metadata?.task_id;

    const webhookEvent: any = {
      event_type: event,
      payload: {
        ...data,
        metadata
      },
      domain,
      processed: false
    };

    // If we have a task_id, use it as the id for upsert to prevent duplicates
    if (taskId) {
      webhookEvent.id = taskId;
    }

    // Use upsert instead of insert to handle retries gracefully
    // onConflict: 'id' means if a row with this id exists, update it
    const { error } = await supabase
      .from('webhook_events_queue')
      .upsert(webhookEvent, {
        onConflict: 'id'
      });

    if (error) {
      console.error("Failed to queue webhook event:", error);
    } else {
      console.log(`Queued webhook event: ${event} for domain: ${domain} (task_id: ${taskId || 'N/A'})`);
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

  // Normalize status to lowercase for case-insensitive matching
  const normalizedStatus = status.toLowerCase();

  switch (normalizedStatus) {
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
    .eq('task_id', taskId)  // Use task_id (string) not id (UUID)
    .single();

  if (!task) {
    console.error(`Task not found for content status webhook: ${taskId}`);
    return;
  }

  const domain = extractDomain(task.live_post_url || task.url, task.metadata, task.custom_fields);

  await queueWebhookEvent(
    supabase,
    event,
    {
      task_id: taskId,
      status,
      title: task.title,
      url: task.live_post_url || task.url,
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
    .eq('task_id', taskId)  // Use task_id (string) not id (UUID)
    .single();

  if (!task) {
    console.error(`Task not found for progress webhook: ${taskId}`);
    return;
  }

  const domain = extractDomain(task.live_post_url || task.url, task.metadata, task.custom_fields);

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
    .eq('task_id', taskId)  // Use task_id (string) not id (UUID)
    .single();

  if (!task) {
    console.error(`Task not found for research webhook: ${taskId}`);
    return;
  }

  const domain = extractDomain(task.live_post_url || task.url, task.metadata, task.custom_fields);

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
    .eq('task_id', taskId)  // Use task_id (string) not id (UUID)
    .single();

  if (!task) {
    console.error(`Task not found for draft webhook: ${taskId}`);
    return;
  }

  const domain = extractDomain(task.live_post_url || task.url, task.metadata, task.custom_fields);

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
    .eq('task_id', taskId)  // Use task_id (string) not id (UUID)
    .single();

  if (!task) {
    console.error(`Task not found for QA webhook: ${taskId}`);
    return;
  }

  const domain = extractDomain(task.live_post_url || task.url, task.metadata, task.custom_fields);

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

/**
 * Notify webhook about content creation (HTML/markdown generated)
 */
export async function notifyContentCreated(
  supabase: any,
  taskId: string,
  contentData: {
    html?: string;
    markdown?: string;
    word_count?: number;
    has_schema?: boolean;
  }
): Promise<void> {
  // Get task details for domain
  const { data: task } = await supabase
    .from('tasks')
    .select('*')
    .eq('task_id', taskId)
    .single();

  if (!task) {
    console.error(`Task not found for content_created webhook: ${taskId}`);
    return;
  }

  const domain = extractDomain(task.live_post_url, task.metadata, task.custom_fields);

  await queueWebhookEvent(
    supabase,
    'content_created',
    {
      task_id: taskId,
      title: task.title,
      url: task.live_post_url,
      word_count: contentData.word_count,
      has_html: !!contentData.html,
      has_markdown: !!contentData.markdown,
      has_schema: contentData.has_schema || false,
      created_at: new Date().toISOString()
    },
    domain,
    {
      task_id: taskId,
      ...task.metadata
    }
  );
}

/**
 * Notify webhook about schema generation completion
 * Used by: generate-schema, generate-schema-stream, generate-schema-perfect
 */
export async function notifySchemaGenerated(
  supabase: any,
  taskId: string,
  schemaData: {
    schema?: string;
    schema_type?: string;
    validation_status?: string;
    url?: string;
    reasoning?: string;
  }
): Promise<void> {
  // Get task details for domain
  const { data: task } = await supabase
    .from('tasks')
    .select('*')
    .eq('task_id', taskId)
    .single();

  if (!task) {
    console.error(`Task not found for schema_generated webhook: ${taskId}`);
    return;
  }

  const domain = extractDomain(task.live_post_url, task.metadata, task.custom_fields);

  await queueWebhookEvent(
    supabase,
    'schema_generated',
    {
      task_id: taskId,
      url: schemaData.url || task.live_post_url,
      schema: schemaData.schema,
      schema_type: schemaData.schema_type || 'Article',
      validation_status: schemaData.validation_status || 'valid',
      reasoning: schemaData.reasoning,
      schema_length: schemaData.schema?.length || 0,
      completed_at: new Date().toISOString()
    },
    domain,
    {
      task_id: taskId,
      ...task.metadata
    }
  );
}