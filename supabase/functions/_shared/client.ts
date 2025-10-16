import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.')
}

export const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
  },
})

type Pipeline = 'content' | 'pageperfect'

function getEventsTable(pipeline: Pipeline) {
  return pipeline === 'content' ? 'content_job_events' : 'pageperfect_job_events'
}

export async function insertEventForPipeline(
  pipeline: Pipeline,
  jobId: string,
  status: string,
  message: string,
  metadata: Record<string, unknown> = {},
  stage?: string
) {
  const { error } = await supabaseAdmin.from(getEventsTable(pipeline)).insert({
    job_id: jobId ?? null,
    stage: stage ?? null,
    status,
    message,
    metadata,
  })
  if (error) {
    console.error(`Failed to insert ${pipeline} job event`, error)
  }
}

export async function insertEvent(jobId: string, status: string, message: string, metadata: Record<string, unknown> = {}) {
  return insertEventForPipeline('content', jobId, status, message, metadata)
}
