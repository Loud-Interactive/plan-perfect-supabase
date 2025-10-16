import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { insertEvent, supabaseAdmin } from '../_shared/client.ts'
import { enqueueJob, batchDequeueJobs } from '../_shared/queue.ts'
import { registerBeforeUnload, runBackground } from '../_shared/runtime.ts'
import { processStageBatch, type StageHandler } from '../_shared/stage-runner.ts'
import { fetchClientSynopsis } from '../_shared/synopsis.ts'
import {
  addStyleTag,
  htmlToMarkdown,
  inlineImages,
  markdownToHtml,
  reinstituteCitations,
} from '../_shared/html.ts'
import { sendEmail } from '../_shared/email.ts'
import { uploadHtmlToDrive } from '../_shared/googleDrive.ts'
import { updateLegacyTask } from '../_shared/tasks.ts'
import { retryExternalAPI } from '../_shared/retry-strategies.ts'
import { FatalStageError } from '../_shared/errors.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const QUEUE_NAME = 'content'
const STAGE_NAME = 'distribution'

registerBeforeUnload(() => console.log('content-export-worker terminating'))

function parseIntegerEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback
  }
  return parsed
}

async function uploadHtml(jobId: string, html: string) {
  const bucket = Deno.env.get('CONTENT_BUCKET') ?? 'content-html'
  const fileName = `${jobId}.html`
  const arrayBuffer = new TextEncoder().encode(html)

  await retryExternalAPI(
    async () => {
      const { error } = await supabaseAdmin.storage.from(bucket).upload(fileName, arrayBuffer, {
        upsert: true,
        contentType: 'text/html; charset=utf-8',
      })
      if (error) {
        throw error
      }
    },
    'supabaseStorage.upload'
  )

  const signedData = await retryExternalAPI(
    async () => {
      const { data, error } = await supabaseAdmin.storage.from(bucket).createSignedUrl(fileName, 60 * 60 * 24 * 7)
      if (error) {
        throw error
      }
      return data
    },
    'supabaseStorage.createSignedUrl'
  )

  const publicUrlResponse = supabaseAdmin.storage.from(bucket).getPublicUrl(fileName)
  const publicUrl = publicUrlResponse.data?.publicUrl ?? null

  return {
    bucket,
    fileName,
    signedUrl: signedData?.signedUrl ?? null,
    publicUrl,
  }
}

type DistributionPayload = Record<string, unknown>

const handleDistributionStage: StageHandler<DistributionPayload> = async ({ jobId, stageInfo }) => {
  await insertEvent(jobId, 'processing', 'Distribution stage started')

  const { data: job, error: jobError } = await supabaseAdmin
    .from('content_jobs')
    .select('payload, requester_email')
    .eq('id', jobId)
    .maybeSingle()

  if (jobError) {
    throw jobError
  }
  if (!job) {
    throw new FatalStageError('Job not found for distribution stage', { metadata: { jobId } })
  }

  const { data: draftData, error: draftError } = await supabaseAdmin
    .from('content_payloads')
    .select('data')
    .eq('job_id', jobId)
    .eq('stage', 'draft')
    .maybeSingle()

  if (draftError) {
    throw draftError
  }
  if (!draftData) {
    throw new FatalStageError('Draft payload missing for distribution stage', { metadata: { jobId } })
  }

  const payload = (job.payload ?? {}) as DistributionPayload
  const requesterEmail = typeof job.requester_email === 'string' ? job.requester_email : undefined

  const draftSections = Array.isArray(draftData.data?.sections)
    ? (draftData.data.sections as string[])
    : []
  const markdown = draftSections.join('\n\n') || htmlToMarkdown(String(payload?.html ?? ''))
  if (!markdown) {
    throw new FatalStageError('Draft markdown missing for distribution stage', { metadata: { jobId } })
  }

  const clientDomain = (payload?.client_domain as string) ?? ''
  const synopsis = await retryExternalAPI(() => fetchClientSynopsis(clientDomain), 'fetchClientSynopsis')
  const synopsisRecord = (synopsis ?? {}) as Record<string, unknown>
  const domainForPrompts =
    clientDomain || (typeof synopsisRecord.domain === 'string' ? (synopsisRecord.domain as string) : null)

  const htmlFromLLM = await retryExternalAPI(
    () => markdownToHtml(markdown, synopsisRecord, Boolean(payload?.regenerate), domainForPrompts ?? undefined),
    'markdownToHtml'
  )

  const htmlWithStyle = addStyleTag(htmlFromLLM, synopsisRecord)
  const inlinedHtml = await retryExternalAPI(() => inlineImages(htmlWithStyle), 'inlineImages')
  const finalHtml = await retryExternalAPI(
    () => reinstituteCitations(inlinedHtml, markdown, synopsisRecord, domainForPrompts ?? undefined),
    'reinstituteCitations'
  )

  const asset = await uploadHtml(jobId, finalHtml)

  const { error: assetError } = await supabaseAdmin
    .from('content_assets')
    .insert({
      job_id: jobId,
      asset_type: 'html',
      storage_path: `${asset.bucket}/${asset.fileName}`,
      external_url: asset.signedUrl,
    })

  if (assetError) {
    throw assetError
  }

  const articleTitle = (payload?.title as string) ?? (payload?.keyword as string) ?? 'ContentPerfect Article'
  const driveLink = await retryExternalAPI(
    () => uploadHtmlToDrive(`${articleTitle}.html`, finalHtml, Deno.env.get('GOOGLE_DRIVE_PARENT_FOLDER_ID') ?? undefined),
    'uploadHtmlToDrive'
  )

  const htmlLinkForTask = asset.publicUrl ?? asset.signedUrl ?? driveLink ?? null
  const googleDocLinkForTask = driveLink ?? asset.publicUrl ?? asset.signedUrl ?? null

  await updateLegacyTask(payload?.content_plan_outline_guid as string | undefined, {
    status: 'Complete',
    content: finalHtml,
    unedited_content: markdown,
    html_link: htmlLinkForTask,
    google_doc_link: googleDocLinkForTask,
    message: 'Content export completed',
  })

  const emailBody =
    `<p>Your HTML content for <strong>${clientDomain}</strong> is ready.</p><p><a href="${driveLink ?? '#'}">Google Drive Link</a></p>`
  const notifyEmails = [requesterEmail, ...(Deno.env.get('TEAM_NOTIFY_EMAILS') ?? '').split(',')]
    .map((value) => value?.trim())
    .filter(Boolean) as string[]

  for (const email of notifyEmails) {
    try {
      await retryExternalAPI(() => sendEmail(email, `[HTML READY] ${articleTitle}`, emailBody), 'sendEmail', {
        maxRetries: 3,
      })
    } catch (emailError) {
      console.error('Failed to send notification email', { jobId, email, error: emailError })
    }
  }

  await supabaseAdmin
    .from('content_jobs')
    .update({
      stage: 'complete',
      status: 'completed',
      attempt_count: stageInfo.attempt_count,
      result: {
        storage: asset,
        drive_link: driveLink,
      },
    })
    .eq('id', jobId)

  await insertEvent(jobId, 'completed', 'Distribution stage completed', {
    storage: asset,
    drive_link: driveLink,
  })

  await enqueueJob(QUEUE_NAME, jobId, 'complete', {})

  return { complete: true }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders })
  }

  const visibility = parseIntegerEnv(Deno.env.get('CONTENT_QUEUE_VISIBILITY'), 600)
  const batchSize = parseIntegerEnv(Deno.env.get('CONTENT_QUEUE_BATCH_SIZE'), 2)

  let records
  try {
    records = await batchDequeueJobs(QUEUE_NAME, visibility, batchSize)
  } catch (error) {
    console.error('Failed to dequeue distribution messages', error)
    return new Response(JSON.stringify({ error: 'queue_pop_failed' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (!records || records.length === 0) {
    return new Response(JSON.stringify({ message: 'no messages' }), {
      status: 204,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  runBackground(async () => {
    await processStageBatch(records, {
      queue: QUEUE_NAME,
      expectedStage: STAGE_NAME,
      visibilitySeconds: visibility,
      handler: handleDistributionStage,
    })
  })

  return new Response(
    JSON.stringify({ message: 'distribution batch scheduled', count: records.length }),
    {
      status: 202,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  )
})
