# PlanPerfect System Documentation

## Overview

PlanPerfect is an AI-powered content generation system that orchestrates a multi-stage pipeline to create high-quality, SEO-optimized content. The system uses a worker-based architecture with queue management to handle long-running content generation tasks without hitting Edge Function timeout limits.

**Key Capabilities**:
- 🔄 Multi-stage content pipeline (Research → Outline → Draft → QA → Export → Complete)
- ⏱️ Asynchronous job processing with queue management
- 🔁 Automatic retry logic with configurable attempts
- 📊 Granular status tracking and event logging
- 🎯 Stage-specific worker specialization
- ⚡ Fire-and-forget execution pattern

## Architecture Overview

### High-Level Flow

```mermaid
graph TD
    A[Client] -->|POST /content-intake| B[Content Intake Function]
    B -->|Create Job| C[(content_jobs table)]
    B -->|Enqueue| D[(pgmq Queue)]
    D -->|Dequeue| E[Research Worker]
    E -->|Complete| D
    D -->|Dequeue| F[Outline Worker]
    F -->|Complete| D
    D -->|Dequeue| G[Draft Worker]
    G -->|Complete| D
    D -->|Dequeue| H[QA Worker]
    H -->|Complete| D
    D -->|Dequeue| I[Export Worker]
    I -->|Complete| D
    D -->|Dequeue| J[Complete Worker]
    J -->|Complete| K[Final Content]
```

### System Components

1. **Intake Function** (`content-intake`)
   - Entry point for content generation requests
   - Creates job records in database
   - Enqueues jobs into pgmq queue
   - Returns job_id immediately (fire-and-forget)

2. **Worker Functions** (6 specialized workers)
   - `content-research-worker`: Research and information gathering
   - `content-outline-worker`: Structure and outline creation
   - `content-draft-worker`: Full content generation
   - `content-qa-worker`: Quality assurance and validation
   - `content-export-worker`: Format and export preparation
   - `content-complete-worker`: Finalization and cleanup

3. **Queue System** (pgmq)
   - PostgreSQL-based message queue (pgmq extension)
   - Message visibility timeout (default: 600 seconds)
   - Automatic message archiving after processing
   - Stage-based routing

4. **Database Tables**
   - `content_jobs`: Job metadata and current status
   - `content_payloads`: Stage-specific data and results
   - `content_events`: Granular event logging
   - `content_stages`: Stage execution tracking

## Detailed Workflow

### Stage 1: Content Intake

**Function**: `content-intake/index.ts`

**Purpose**: Accept content generation requests and initialize the job pipeline.

```typescript
// Request format
{
  "job_type": "article" | "schema",
  "requester_email": "user@example.com",
  "payload": {
    "title": "Article Title",
    "keywords": ["keyword1", "keyword2"],
    "domain": "example.com"
  },
  "initial_stage": "research"  // Optional, defaults to "research"
}

// Response format
{
  "job_id": "uuid-here",
  "status": "queued",
  "stage": "research"
}
```

**Key Code**:
```typescript
// Create job in database
const { data, error } = await supabaseAdmin
  .from('content_jobs')
  .insert({
    job_type: jobType,
    requester_email: body.requester_email,
    payload,
    status: 'queued',
    stage: initialStage,
  })
  .select('id')
  .single()

// Log event
await insertEvent(jobId, 'queued', 'Job queued by intake', {
  payload_keys: Object.keys(payload)
})

// Enqueue to appropriate queue
await enqueueJob(
  jobType === 'schema' ? 'schema' : 'content',
  jobId,
  initialStage,
  payload
)
```

**Flow Chart**:
```
┌─────────────────┐
│  Client Request │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Validate Request│
│  - job_type     │
│  - payload      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Create Job     │
│  Record in DB   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Insert Event   │
│  "queued"       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Enqueue to     │
│  pgmq Queue     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Return job_id  │
│  to Client      │
└─────────────────┘
```

### Stage 2: Research Worker

**Function**: `content-research-worker/index.ts`

**Purpose**: Gather research data, search APIs, scrape sources, and prepare research foundation.

**Key Features**:
- Dequeues messages from pgmq
- Checks stage and forwards if mismatched
- Tracks attempt count for retries
- Runs work in background (fire-and-forget)
- Archives message after processing

**Key Code**:
```typescript
// Dequeue message with visibility timeout
const { data, error } = await supabaseAdmin.rpc('dequeue_stage', {
  p_queue: 'content',
  p_visibility: visibility, // 600 seconds default
})

// Stage validation and forwarding
if (stage !== 'research') {
  console.log(`Research worker received stage ${stage}, forwarding`)
  await enqueueJob('content', jobId, stage, payload)
  await supabaseAdmin.rpc('archive_message', {
    p_queue: 'content',
    p_msg_id: msg_id
  })
  return
}

// Start stage tracking
await insertEvent(jobId, 'processing', 'Research stage started', payload)
const attempt = await startStage(jobId, 'research')

// Background work (fire-and-forget)
const work = (async () => {
  // TODO: Implement real research
  const researchResult = {
    note: 'Research worker placeholder',
    payload,
    completed_at: new Date().toISOString(),
  }

  // Save results
  await supabaseAdmin
    .from('content_payloads')
    .upsert({ job_id: jobId, stage: 'research', data: researchResult })

  // Complete stage
  await completeStage(jobId, 'research')

  // Update job to next stage
  await supabaseAdmin
    .from('content_jobs')
    .update({ stage: 'outline', status: 'queued' })
    .eq('id', jobId)

  // Enqueue next stage
  await enqueueJob('content', jobId, 'outline', { from: 'research-worker' })

  // Archive message
  await supabaseAdmin.rpc('archive_message', {
    p_queue: 'content',
    p_msg_id: msg_id
  })
})()

runBackground(work) // Fire and forget
```

**Flow Chart**:
```
┌──────────────────┐
│ Dequeue Message  │
│  from pgmq       │
└────────┬─────────┘
         │
         ▼
    ┌─────────┐
    │ Empty?  │───Yes──▶ Return 204 No Content
    └────┬────┘
         │ No
         ▼
┌──────────────────┐
│  Extract job_id  │
│  stage, payload  │
└────────┬─────────┘
         │
         ▼
    ┌─────────────┐
    │Stage Match? │───No──▶ Forward to Correct Stage
    └────┬────────┘
         │ Yes
         ▼
┌──────────────────┐
│  Insert Event    │
│  "processing"    │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Start Stage     │
│  (attempt count) │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Fire-and-Forget │
│  Background Work │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Return 202      │
│  "scheduled"     │
└──────────────────┘

Background Process:
         │
         ▼
┌──────────────────┐
│  Do Research     │
│  (API calls,     │
│   scraping, etc) │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Save Results    │
│  to Payloads     │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Complete Stage  │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Update Job      │
│  stage="outline" │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Enqueue Next    │
│  Stage           │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Archive Message │
└──────────────────┘
```

### Stage 3: Outline Worker

**Function**: `content-outline-worker/index.ts`

**Purpose**: Generate structured outline based on research data.

**Key Features**:
- Same pattern as research worker
- Dequeue → Validate → Process → Enqueue next
- Stores outline structure in payloads
- Forwards to draft stage upon completion

**Key Code**:
```typescript
const work = (async () => {
  const outlineResult = {
    note: 'Outline worker placeholder',
    sections: [],
    completed_at: new Date().toISOString(),
  }

  await supabaseAdmin
    .from('content_payloads')
    .upsert({ job_id: jobId, stage: 'outline', data: outlineResult })

  await completeStage(jobId, 'outline')

  await supabaseAdmin
    .from('content_jobs')
    .update({ stage: 'draft', status: 'queued' })
    .eq('id', jobId)

  await enqueueJob('content', jobId, 'draft', { from: 'outline-worker' })

  await supabaseAdmin.rpc('archive_message', {
    p_queue: 'content',
    p_msg_id: msg_id
  })
})()
```

### Stage 4: Draft Worker

**Function**: `content-draft-worker/index.ts`

**Purpose**: Generate full content draft based on outline and research.

**Key Features**:
- Retrieves research and outline data from previous stages
- Generates complete article content
- Forwards to QA stage for validation

### Stage 5: QA Worker

**Function**: `content-qa-worker/index.ts`

**Purpose**: Quality assurance and validation of generated content.

**Key Features**:
- Validates content quality
- Checks for completeness
- Verifies SEO requirements
- Forwards to export stage

### Stage 6: Export Worker

**Function**: `content-export-worker/index.ts`

**Purpose**: Format content for final export (WordPress, Shopify, etc).

**Key Features**:
- Formats content for target platform
- Generates schema markup
- Prepares images and media
- Forwards to complete stage

### Stage 7: Complete Worker

**Function**: `content-complete-worker/index.ts`

**Purpose**: Finalize job and trigger any post-processing.

**Key Features**:
- Marks job as complete
- Triggers notifications
- Archives job data
- Cleanup temporary resources

## Error Handling & Retry Logic

### Retry Mechanism

Each worker implements automatic retry logic:

```typescript
const maxAttempts = Number(Deno.env.get('CONTENT_STAGE_MAX_ATTEMPTS') ?? '3')

try {
  // Do work...
  await completeStage(jobId, 'research')
} catch (workerError) {
  console.error('Research worker failure', workerError)
  await insertEvent(jobId, 'error', 'Research stage failed', { error: workerError })
  await failStage(jobId, 'research', workerError)

  // Retry if under max attempts
  if (attempt < maxAttempts) {
    await enqueueJob('content', jobId, 'research', payload)
  }
  await supabaseAdmin.rpc('archive_message', {
    p_queue: 'content',
    p_msg_id: msg_id
  })
}
```

### Error States

| Status | Description | Action |
|--------|-------------|--------|
| `queued` | Job waiting in queue | Normal state |
| `processing` | Worker actively processing | Normal state |
| `completed` | Stage completed successfully | Move to next stage |
| `error` | Stage failed | Retry if attempts < max |
| `failed` | All retries exhausted | Manual intervention required |

## Database Schema

### content_jobs

Primary job tracking table:

```sql
CREATE TABLE content_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_type TEXT NOT NULL,  -- 'article', 'schema', etc.
  requester_email TEXT,
  payload JSONB,
  status TEXT NOT NULL,    -- 'queued', 'processing', 'completed', 'failed'
  stage TEXT NOT NULL,     -- Current stage: 'research', 'outline', etc.
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### content_payloads

Stage-specific results storage:

```sql
CREATE TABLE content_payloads (
  job_id UUID REFERENCES content_jobs(id),
  stage TEXT NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (job_id, stage)
);
```

### content_events

Granular event logging:

```sql
CREATE TABLE content_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id UUID REFERENCES content_jobs(id),
  event_type TEXT NOT NULL,  -- 'queued', 'processing', 'completed', 'error'
  message TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### content_stages

Stage execution tracking:

```sql
CREATE TABLE content_stages (
  job_id UUID REFERENCES content_jobs(id),
  stage TEXT NOT NULL,
  status TEXT NOT NULL,      -- 'pending', 'processing', 'completed', 'failed'
  attempt_count INTEGER DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  PRIMARY KEY (job_id, stage)
);
```

## Queue Management (pgmq)

### Enqueue Function

```typescript
// _shared/queue.ts
export async function enqueueJob(
  queue: 'content' | 'schema',
  jobId: string,
  stage: string,
  payload: Record<string, unknown>
) {
  const message = {
    job_id: jobId,
    stage,
    payload,
  }

  const { error } = await supabaseAdmin.rpc('enqueue_stage', {
    p_queue: queue,
    p_message: message,
  })

  if (error) {
    console.error(`Failed to enqueue ${stage} for job ${jobId}`, error)
    throw error
  }
}
```

### Dequeue Function

```typescript
// Used by all workers
const { data, error } = await supabaseAdmin.rpc('dequeue_stage', {
  p_queue: 'content',
  p_visibility: 600, // Visibility timeout in seconds
})

if (!data || data.length === 0) {
  // No messages in queue
  return new Response(JSON.stringify({ message: 'no messages' }), {
    status: 204,
  })
}

const { msg_id, message } = data[0]
const { job_id, stage, payload } = message
```

### Message Visibility Timeout

**Purpose**: Prevents message from being dequeued by another worker while being processed.

- Default: 600 seconds (10 minutes)
- Configurable via `CONTENT_QUEUE_VISIBILITY` env var
- If worker doesn't archive message before timeout, it becomes visible again
- Enables automatic retry on worker crashes

## Configuration

### Environment Variables

```bash
# Queue visibility timeout (seconds)
CONTENT_QUEUE_VISIBILITY=600

# Maximum retry attempts per stage
CONTENT_STAGE_MAX_ATTEMPTS=3

# Supabase connection (auto-set)
SUPABASE_URL=https://project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# API keys for content generation
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GROQ_API_KEY=gsk_...
```

### Worker Configuration

Each worker can have custom config.toml:

```toml
# supabase/functions/content-research-worker/config.toml
verify_jwt = false  # No JWT verification for background workers
```

## Performance Considerations

### Fire-and-Forget Pattern

Workers return immediately (202 Accepted) and run work in background:

```typescript
// Return response ASAP
const work = (async () => {
  // Long-running work here...
})()

runBackground(work)

return new Response(JSON.stringify({ message: 'scheduled', job_id: jobId }), {
  status: 202,
})
```

**Benefits**:
- Avoids Edge Function 60-second timeout
- Allows parallel processing
- Enables automatic retries
- Provides better error handling

### Stage Isolation

Each stage is independent:
- Can be developed separately
- Can be deployed independently
- Can be scaled independently
- Failures don't affect other stages

### Message Archiving

Messages are archived (not deleted) for audit trail:
- Debugging failed jobs
- Understanding processing patterns
- Monitoring queue health
- Compliance and logging

## Monitoring & Debugging

### Check Job Status

```sql
-- Get job current state
SELECT id, job_type, status, stage, created_at, updated_at
FROM content_jobs
WHERE id = 'job-id-here';

-- Get all events for a job
SELECT event_type, message, metadata, created_at
FROM content_events
WHERE job_id = 'job-id-here'
ORDER BY created_at DESC;

-- Get stage execution details
SELECT stage, status, attempt_count, started_at, completed_at, error_message
FROM content_stages
WHERE job_id = 'job-id-here'
ORDER BY started_at;

-- Get stage payloads
SELECT stage, data
FROM content_payloads
WHERE job_id = 'job-id-here';
```

### Check Queue Health

```sql
-- Check message count in queue
SELECT pgmq.queue_metrics('content');

-- View messages in queue (debugging)
SELECT * FROM pgmq.content_queue
LIMIT 10;

-- View archived messages
SELECT * FROM pgmq.content_archive
ORDER BY archived_at DESC
LIMIT 10;
```

### Common Issues

| Issue | Symptoms | Solution |
|-------|----------|----------|
| Worker timeout | Jobs stuck in processing | Increase visibility timeout |
| All retries exhausted | Jobs in failed state | Check error_message in content_stages |
| Queue backlog | High message count | Scale up worker invocations |
| Stage mismatch | Worker receives wrong stage | Check stage forwarding logic |
| Missing payload | Worker errors on data access | Verify previous stage completed |

## Integration Example

### Creating a Content Generation Job

```typescript
// Client code
async function generateArticle() {
  const response = await fetch('https://project.supabase.co/functions/v1/content-intake', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({
      job_type: 'article',
      requester_email: 'user@example.com',
      payload: {
        title: 'How to Build a Content Pipeline',
        keywords: ['content', 'pipeline', 'automation'],
        domain: 'example.com',
        word_count: 2000,
      },
    }),
  })

  const { job_id } = await response.json()
  console.log('Job created:', job_id)

  // Poll for completion
  const interval = setInterval(async () => {
    const statusRes = await fetch(`https://project.supabase.co/rest/v1/content_jobs?id=eq.${job_id}`, {
      headers: {
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'apikey': SUPABASE_ANON_KEY,
      },
    })

    const [job] = await statusRes.json()

    if (job.status === 'completed') {
      clearInterval(interval)
      console.log('Job completed!', job)
    } else if (job.status === 'failed') {
      clearInterval(interval)
      console.error('Job failed')
    }
  }, 5000) // Poll every 5 seconds
}
```

## Future Enhancements

### Planned Features
- [ ] Real research implementation (search APIs, web scraping)
- [ ] AI-powered outline generation
- [ ] Multiple AI providers (Claude, GPT-4, Llama)
- [ ] WordPress publishing integration
- [ ] Shopify publishing integration
- [ ] Schema markup generation
- [ ] Image generation and optimization
- [ ] SEO optimization suggestions
- [ ] A/B testing support
- [ ] Content versioning

### Performance Optimizations
- [ ] Worker pooling for parallel processing
- [ ] Redis caching for frequently accessed data
- [ ] Batch processing for multiple jobs
- [ ] Priority queue implementation
- [ ] Dead letter queue for failed jobs

## Related Documentation

- [Outline Generation System](./OUTLINE-GENERATION-SYSTEM.md)
- [PagePerfect System](./PAGEPERFECT-SYSTEM.md)
- [GSC Integration](./GSC-INTEGRATION-SYSTEM.md)
- [Deployment Guide](../supabase/functions/MASTER_DEPLOYMENT.md)
