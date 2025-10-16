# PagePerfect Queue-Based Architecture Migration

This document summarizes the completed migration of PagePerfect workflow to a resilient queue-based architecture.

## Overview

The PagePerfect workflow has been re-architected from a monolithic sequential execution to a queue-based pipeline with discrete workers, mirroring the PlanPerfect (content) pipeline architecture.

## Completed Components

### 1. Database Migrations ✅

#### `/supabase/migrations/20251016120000_pageperfect_queue_infrastructure.sql`
Creates the core queue infrastructure:
- `pageperfect_jobs` - Main job tracking table
- `pageperfect_job_stages` - Per-stage progress with retry metadata
- `pageperfect_dead_letters` - Dead letter queue for failed messages
- `pageperfect_job_events` - Complete audit trail
- `pageperfect_payloads` - Inter-stage data passing
- `pageperfect` pgmq queue
- All necessary RPCs for queue operations
- Monitoring views

#### `/supabase/migrations/20251016120100_pageperfect_dispatcher_config.sql`
Configures the dispatcher:
- Adds PagePerfect stages to `content_stage_config`
- Updates `get_content_stage_backlog()` to include PagePerfect stages
- Sets concurrency limits per stage

### 2. Shared Helpers (Updated) ✅

#### `/supabase/functions/_shared/stages.ts`
Extended to support both pipelines:
- `startStageForPipeline()` - Supports 'content' | 'pageperfect'
- `completeStageForPipeline()`
- `failStageForPipeline()`
- `shouldDeadLetterForPipeline()`
- Backward compatible wrappers for content pipeline

#### `/supabase/functions/_shared/client.ts`
Extended event insertion:
- `insertEventForPipeline()` - Supports both pipelines
- Backward compatible `insertEvent()` for content

#### `/supabase/functions/_shared/queue.ts`
Extended queue operations:
- Automatic RPC routing based on queue name
- `getPipelineForQueue()` helper
- All operations support both pipelines

### 3. Intake Functions ✅

#### `/supabase/functions/pageperfect-workflow/index.ts` (Refactored)
Simplified to pure intake:
- Validates input (URL or pageId)
- Resolves or creates page record
- Creates pageperfect_job via RPC
- Enqueues initial `submit_crawl` stage
- Returns job tracking information

#### `/supabase/functions/pageperfect-intake/index.ts`
Alternative intake endpoint (identical functionality to pageperfect-workflow)

### 4. Worker Functions

#### `/supabase/functions/pageperfect-submit-crawl-worker/index.ts` ✅ (Implemented)
First stage worker:
- Dequeues messages from pageperfect queue
- Creates crawl_jobs record
- Handles retry/dead-letter logic
- Enqueues wait_crawl stage
- Includes skipSteps support

#### Remaining Workers (Template Provided)
See `/supabase/functions/PAGEPERFECT-QUEUE-WORKERS.md` for:
- `pageperfect-wait-crawl-worker` - Poll crawl completion
- `pageperfect-segment-embed-worker` - Generate embeddings
- `pageperfect-keyword-clustering-worker` - DBSCAN clustering
- `pageperfect-gap-analysis-worker` - Identify content gaps
- `pageperfect-rewrite-draft-worker` - Generate recommendations

All follow the same pattern as submit-crawl-worker with stage-specific logic.

### 5. Documentation ✅

#### `/supabase/functions/PAGEPERFECT-QUEUE-WORKERS.md`
Comprehensive worker implementation guide:
- Complete worker template
- Stage-by-stage implementation details
- Testing instructions
- Deployment guide

#### `/docs/PAGEPERFECT-SYSTEM.md` (Updated)
Updated architecture diagrams and component descriptions

## Architecture Benefits

### Resilience
- Automatic retry with exponential backoff
- Dead-letter queues for failed messages
- No data loss on worker failures

### Observability
- Complete event trail in `pageperfect_job_events`
- Stage-level progress tracking
- Granular metrics per stage

### Scalability
- Independent stage concurrency controls
- Dispatcher-based worker orchestration
- Horizontal scaling per stage

### Maintainability
- Shared helpers eliminate code duplication
- Consistent error handling patterns
- Easier debugging and testing

## Migration Impact

### Breaking Changes
- `pageperfect-workflow` now returns immediately with job_id instead of waiting for completion
- Clients must poll job status or use webhooks for completion notification

### Backward Compatibility
- Existing `pageperfect-workflow` intake maintains same request interface
- All original step functions (submit-crawl-job, etc.) remain functional for direct calls
- Batch processor unaffected (calls intake endpoint)

## Next Steps

To complete the migration:

1. **Implement remaining workers** using the template in `PAGEPERFECT-QUEUE-WORKERS.md`
2. **Deploy all workers** to Supabase
3. **Run migrations** on production database
4. **Test end-to-end** with sample URLs
5. **Monitor** dead letter queues and adjust retry parameters
6. **Update** client applications to poll job status
7. **Add webhooks** (optional) for job completion notifications

## Testing Checklist

- [ ] Run migrations on staging database
- [ ] Deploy pageperfect-submit-crawl-worker
- [ ] Test intake endpoint creates job and enqueues stage
- [ ] Verify dispatcher triggers worker
- [ ] Confirm retry logic on intentional failures
- [ ] Check dead-letter routing after max attempts
- [ ] Implement and test remaining workers
- [ ] End-to-end workflow test
- [ ] Load test with concurrent jobs
- [ ] Verify monitoring views and metrics

## Rollback Plan

If issues arise:
1. Disable PagePerfect dispatcher stages in `content_stage_config` (set enabled=false)
2. Drain pageperfect queue
3. Revert to monolithic pageperfect-workflow (preserve old version)
4. Tables can remain (migrations are non-destructive)

## Monitoring Queries

```sql
-- Active jobs
SELECT * FROM v_pageperfect_job_status 
WHERE status IN ('queued', 'processing') 
ORDER BY created_at DESC;

-- Recent events
SELECT * FROM pageperfect_job_events 
WHERE created_at > now() - interval '1 hour' 
ORDER BY created_at DESC 
LIMIT 100;

-- Dead letters
SELECT * FROM pageperfect_dead_letters 
ORDER BY routed_at DESC 
LIMIT 50;

-- Stage backlog
SELECT * FROM get_pageperfect_stage_backlog();

-- Dispatcher config
SELECT * FROM content_stage_config 
WHERE queue = 'pageperfect';
```

## Performance Tuning

### Concurrency Limits
Adjust in `content_stage_config`:
```sql
UPDATE content_stage_config 
SET max_concurrency = 5 
WHERE stage = 'submit_crawl';
```

### Retry Parameters
Adjust per-job or globally:
```sql
-- Per-job
UPDATE pageperfect_jobs 
SET max_attempts = 3, retry_delay_seconds = 30 
WHERE id = 'job-id';

-- Per-stage
UPDATE pageperfect_job_stages 
SET max_attempts = 3, retry_delay_seconds = 30 
WHERE job_id = 'job-id' AND stage = 'submit_crawl';
```

### Queue Visibility
Environment variable:
```bash
PAGEPERFECT_QUEUE_VISIBILITY=600  # seconds
```

## Support

For issues or questions:
1. Check `pageperfect_job_events` for error details
2. Review `pageperfect_dead_letters` for failed messages
3. Consult `PAGEPERFECT-QUEUE-WORKERS.md` for implementation guidance
4. Examine `_shared/stages.ts` and `_shared/queue.ts` for helper behavior

## Summary

This migration establishes a robust, scalable foundation for PagePerfect workflows with:
- ✅ Complete database schema and migrations
- ✅ Shared helper functions supporting both pipelines
- ✅ Refactored intake function
- ✅ One fully-implemented worker (submit-crawl)
- ✅ Complete templates and documentation for remaining workers
- ✅ Dispatcher configuration
- ✅ Updated system documentation

The architecture mirrors PlanPerfect exactly, ensuring consistent behavior, maintainability, and reliability across both content generation pipelines.
