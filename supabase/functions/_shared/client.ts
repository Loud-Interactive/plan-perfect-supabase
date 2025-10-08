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

export async function insertEvent(jobId: string, status: string, message: string, metadata: Record<string, unknown> = {}) {
  const { error } = await supabaseAdmin.from('content_job_events').insert({
    job_id: jobId,
    status,
    message,
    metadata,
  })
  if (error) {
    console.error('Failed to insert job event', error)
  }
}
