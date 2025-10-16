# PagePerfect Queue-Based Workers

This document describes the queue-based architecture for PagePerfect workflows and provides templates for implementing the worker functions.

## Overview

The PagePerfect workflow has been re-architected onto a resilient queue-based system mirroring the PlanPerfect (content) pipeline. This provides:

- **Resilience**: Automatic retries with exponential backoff
- **Observability**: Full event tracking and dead-letter queues
- **Scalability**: Independent stage scaling via dispatcher
- **Reliability**: No data loss, persistent state tracking

## Architecture

### Tables
- `pageperfect_jobs`: Main job records
- `pageperfect_job_stages`: Stage-level tracking with retry metadata
- `pageperfect_dead_letters`: Failed messages for manual intervention
- `pageperfect_job_events`: Audit trail of all job events
- `pageperfect_payloads`: Stage-specific payload data

### Queue
- `pageperfect`: pgmq queue for all PagePerfect stages

### Stages
1. `submit_crawl` - Submit crawl job to crawl_jobs table
2. `wait_crawl` - Poll crawl job until completion
3. `segment_embed` - Segment page HTML and generate embeddings
4. `keyword_clustering` - Perform DBSCAN clustering on keywords
5. `gap_analysis` - Identify content gaps vs keyword clusters
6. `rewrite_draft` - Generate rewrite recommendations

## Worker Template

Each worker follows this pattern:

```typescript
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { supabaseAdmin, insertEventForPipeline } from '../_shared/client.ts'
import {
  enqueueJob,
  dequeueNextJob,
  ackMessage,
  delayedRequeueJob,
  moveToDeadLetter,
  QueueMessage,
} from '../_shared/queue.ts'
import { runBackground, registerBeforeUnload } from '../_shared/runtime.ts'
import {
  startStageForPipeline,
  completeStageForPipeline,
  failStageForPipeline,
  shouldDeadLetterForPipeline,
} from '../_shared/stages.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const QUEUE = 'pageperfect'
const STAGE = 'stage_name' // Change per worker
const NEXT_STAGE = 'next_stage_name' // Change per worker

registerBeforeUnload(() => {
  console.log(`pageperfect-${STAGE}-worker terminating`)
})

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders })
  }

  const visibility = Number(Deno.env.get('PAGEPERFECT_QUEUE_VISIBILITY') ?? '600')

  let record: QueueMessage | null = null
  try {
    record = await dequeueNextJob(QUEUE, visibility)
  } catch (error) {
    console.error('Failed to pop message', error)
    return new Response(JSON.stringify({ error: 'queue_pop_failed' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (!record) {
    return new Response(JSON.stringify({ message: 'no messages' }), {
      status: 204,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const { msg_id, message } = record
  const jobId = message?.job_id
  const stage = message?.stage ?? STAGE
  const payload = (message?.payload ?? {}) as Record<string, unknown>

  if (!jobId) {
    console.warn('Message missing job_id, acknowledging without processing')
    await ackMessage(QUEUE, msg_id)
    return new Response(JSON.stringify({ message: 'invalid message acknowledged' }), {
      status: 202,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Forward messages not for this stage
  if (stage !== STAGE) {
    console.log(`${STAGE} worker received stage ${stage}, forwarding`)
    await enqueueJob(QUEUE, jobId, stage, payload, {
      priority: message?.priority ?? 0,
    })
    await ackMessage(QUEUE, msg_id)
    return new Response(JSON.stringify({ message: `forwarded stage ${stage}` }), {
      status: 202,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  await insertEventForPipeline('pageperfect', jobId, 'processing', `${STAGE} stage started`, payload, stage)
  const stageInfo = await startStageForPipeline('pageperfect', jobId, STAGE)

  const work = (async () => {
    try {
      // ====== STAGE-SPECIFIC LOGIC HERE ======
      // 1. Extract data from payload
      // 2. Perform stage work
      // 3. Prepare next payload
      
      const result = await performStageWork(payload)
      
      const nextPayload = {
        ...payload,
        // Add stage results
      }

      // Save payload
      const { error: payloadError } = await supabaseAdmin
        .from('pageperfect_payloads')
        .upsert({ job_id: jobId, stage: STAGE, data: nextPayload })

      if (payloadError) {
        throw payloadError
      }

      await completeStageForPipeline('pageperfect', jobId, STAGE)

      // Update job to next stage if not final
      if (NEXT_STAGE) {
        await supabaseAdmin
          .from('pageperfect_jobs')
          .update({
            stage: NEXT_STAGE,
            status: 'queued',
            attempt_count: stageInfo.attempt_count,
          })
          .eq('id', jobId)
      } else {
        // Final stage - mark job complete
        await supabaseAdmin
          .from('pageperfect_jobs')
          .update({
            status: 'completed',
            last_completed_at: new Date().toISOString(),
          })
          .eq('id', jobId)
      }

      await insertEventForPipeline('pageperfect', jobId, 'completed', `${STAGE} stage completed`, result, stage)

      // Enqueue next stage
      if (NEXT_STAGE) {
        await enqueueJob(QUEUE, jobId, NEXT_STAGE, nextPayload, {
          priority: stageInfo.priority,
        })
      }

      await ackMessage(QUEUE, msg_id)
    } catch (workerError) {
      console.error(`${STAGE} worker failure`, workerError)
      await insertEventForPipeline('pageperfect', jobId, 'error', `${STAGE} stage failed`, { error: workerError }, stage)
      await failStageForPipeline('pageperfect', jobId, STAGE, workerError)

      if (await shouldDeadLetterForPipeline('pageperfect', jobId, STAGE)) {
        await moveToDeadLetter(
          QUEUE,
          msg_id,
          jobId,
          STAGE,
          message,
          'max_attempts_exceeded',
          { error: workerError },
          stageInfo.attempt_count
        )
        return
      }

      await delayedRequeueJob(QUEUE, msg_id, jobId, STAGE, payload, {
        baseDelaySeconds: stageInfo.retry_delay_seconds,
        priorityOverride: stageInfo.priority,
        visibilitySeconds: visibility,
      })
    }
  })()

  runBackground(work)

  return new Response(JSON.stringify({ message: `${STAGE} stage scheduled`, job_id: jobId, msg_id }), {
    status: 202,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})

// Stage-specific implementation
async function performStageWork(payload: Record<string, unknown>) {
  // Implement stage logic here
  return {}
}
```

## Worker Implementation Guide

### 1. Submit Crawl Worker (`pageperfect-submit-crawl-worker`)
✅ **Implemented** - See `/supabase/functions/pageperfect-submit-crawl-worker/index.ts`

**Logic**:
- Extract URL, pageId, premium, ultraPremium, render from payload
- Insert record into `crawl_jobs` table with status='pending'
- Add `crawl_job_id` to payload for next stage
- Enqueue `wait_crawl` stage

### 2. Wait Crawl Worker (`pageperfect-wait-crawl-worker`)
**Logic**:
- Extract `crawl_job_id` from payload
- Poll `crawl_jobs` table checking status
- Use exponential backoff for polling (e.g., 5s, 10s, 20s)
- If status='completed', extract HTML and add to payload
- If status='error', throw error to trigger retry
- Max wait time ~5 minutes before considering it failed
- Enqueue `segment_embed` stage

**Key Points**:
- Use `extendVisibility()` if polling takes long
- Store HTML length, processing time in payload

### 3. Segment Embed Worker (`pageperfect-segment-embed-worker`)
**Logic**:
- Extract pageId, HTML from payload (or fetch from pages table)
- Use Cheerio to parse HTML and extract paragraphs (reuse logic from `segment-and-embed-page/index.ts`)
- Generate OpenAI embeddings for each paragraph
- Delete existing `page_embeddings` for this page
- Insert new embeddings into `page_embeddings` table
- Enqueue `keyword_clustering` stage

**Key Points**:
- Batch embedding requests for efficiency
- Handle OpenAI rate limits with retry logic
- Store paragraph count in payload

### 4. Keyword Clustering Worker (`pageperfect-keyword-clustering-worker`)
**Logic**:
- Extract pageId from payload
- Fetch keywords from `gsc_page_query` table for this page's URL
- Generate embeddings for each keyword using OpenAI
- Apply DBSCAN clustering algorithm (reuse logic from `keyword-clustering/index.ts`)
- Delete existing `keyword_clusters` for this page
- Insert cluster results into `keyword_clusters` table
- Enqueue `gap_analysis` stage

**Key Points**:
- DBSCAN parameters: eps=0.3, minPts=2
- Handle keywords with no cluster (noise points)
- Store cluster count in payload

### 5. Gap Analysis Worker (`pageperfect-gap-analysis-worker`)
**Logic**:
- Extract pageId from payload
- Fetch page embeddings and keyword clusters
- Calculate cosine similarity between each cluster centroid and page paragraphs
- Identify clusters with low similarity (gaps)
- Score opportunities using impressions, position, similarity
- Delete existing `rewrite_recommendations` for this page
- Insert recommendations into `rewrite_recommendations` table
- Enqueue `rewrite_draft` stage

**Key Points**:
- Similarity threshold: <0.7 indicates gap
- Sort by opportunity score (impressions * (1 - similarity))
- Store top 10 recommendations

### 6. Rewrite Draft Worker (`pageperfect-rewrite-draft-worker`)
**Logic**:
- Extract pageId, top recommendation from payload
- Fetch cluster keywords and page content
- Generate rewrite suggestions using LLM (Claude or GPT-4)
- Store draft in `rewrite_drafts` table or in job result
- Mark job as completed (final stage)

**Key Points**:
- This is the final stage - set job status='completed'
- Store all results in `pageperfect_jobs.result` jsonb column
- Consider making draft generation optional based on payload

## Dispatcher Configuration

The dispatcher is already configured in migration `20251016120100_pageperfect_dispatcher_config.sql`:

```sql
('submit_crawl', 'pageperfect', 'pageperfect-submit-crawl-worker', 3, 1),
('wait_crawl', 'pageperfect', 'pageperfect-wait-crawl-worker', 2, 1),
('segment_embed', 'pageperfect', 'pageperfect-segment-embed-worker', 3, 1),
('keyword_clustering', 'pageperfect', 'pageperfect-keyword-clustering-worker', 2, 1),
('gap_analysis', 'pageperfect', 'pageperfect-gap-analysis-worker', 2, 1),
('rewrite_draft', 'pageperfect', 'pageperfect-rewrite-draft-worker', 2, 1)
```

The existing `content-queue-dispatcher` function will automatically handle PagePerfect stages.

## Testing

1. **Create a job**:
```bash
curl -X POST https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/pageperfect-workflow \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com", "priority": 1}'
```

2. **Monitor progress**:
```sql
SELECT * FROM v_pageperfect_job_status WHERE job_id = 'xxx';
SELECT * FROM pageperfect_job_events WHERE job_id = 'xxx' ORDER BY created_at DESC;
SELECT * FROM pageperfect_job_stages WHERE job_id = 'xxx';
```

3. **Check dead letters**:
```sql
SELECT * FROM pageperfect_dead_letters ORDER BY routed_at DESC;
```

## Deployment

Deploy workers using Supabase CLI:
```bash
supabase functions deploy pageperfect-submit-crawl-worker
supabase functions deploy pageperfect-wait-crawl-worker
# ... etc
```

## Environment Variables

- `PAGEPERFECT_QUEUE_VISIBILITY`: Message visibility timeout (default: 600s)
- `OPENAI_API_KEY`: For embeddings generation
- `SCRAPER_API_KEY`: For crawling (inherited by crawl cron)

## Migration Order

1. `20251016120000_pageperfect_queue_infrastructure.sql` - Tables, queue, RPCs
2. `20251016120100_pageperfect_dispatcher_config.sql` - Dispatcher configuration

## Shared Helpers

All workers use these shared modules:
- `_shared/client.ts` - Supabase client and event insertion
- `_shared/queue.ts` - Queue operations (enqueue, dequeue, ack, etc.)
- `_shared/stages.ts` - Stage lifecycle (start, complete, fail)
- `_shared/runtime.ts` - Background task handling

These have been updated to support both `content` and `pageperfect` pipelines via the pipeline parameter.
