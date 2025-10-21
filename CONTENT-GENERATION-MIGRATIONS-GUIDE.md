# Content Generation Functions - Migration Guide

## 🎯 Overview

This guide covers the required database migrations for all content generation edge functions, including:
- `content-*` worker functions (intake, research, outline, draft, QA, complete, export)
- `generate-side-by-side` (HTML generation with AI callouts)
- `generate-seo-elements-ds` and `generate-seo-elements-gptoss`
- Content job orchestration and queue management

---

## 📋 Prerequisites

Before running migrations:

```bash
# Ensure you have:
- Supabase CLI installed
- Database credentials configured
- PGMQ extension available (for queue management)
- Service role key set in environment
```

---

## 🗂️ Migration Order (CRITICAL)

### Phase 1: Core Foundation (MUST RUN FIRST)

These create the essential database structure:

#### 1. **Content Jobs Infrastructure** (Required First)
```bash
# Creates content_jobs, content_payloads, content_job_events, content_assets tables
# Also creates PGMQ queue functions
supabase db push --file supabase/migrations/20250919_content_jobs.sql
```

**What it creates:**
- ✅ `content_jobs` table - Main job tracking
- ✅ `content_payloads` table - Stage-specific data  
- ✅ `content_job_events` table - Event logging
- ✅ `content_assets` table - Asset tracking
- ✅ `content_job_stages` table - Stage status tracking
- ✅ Helper functions: `enqueue_stage()`, `dequeue_stage()`, `archive_message()`
- ✅ Monitoring view: `v_content_job_status`

**Dependencies:**
- Requires PGMQ extension

---

#### 2. **Content Queue Setup** (Required Second)
```bash
# Creates PGMQ queues for content processing
supabase db push --file supabase/migrations/20250919_create_content_queue.sql
```

**What it creates:**
- ✅ `content` queue - Main content processing
- ✅ `schema` queue - Schema generation jobs
- ✅ `tsv` queue - TSV intake jobs

**Dependencies:**
- Requires PGMQ extension (installed in step 1)

---

#### 3. **Content Queue Hardening** (Stability)
```bash
# Adds error handling and retry logic
supabase db push --file supabase/migrations/20251016112651_content_queue_hardening.sql
```

**What it adds:**
- ✅ Enhanced error handling
- ✅ Retry mechanisms
- ✅ Dead letter queue support
- ✅ Better monitoring

---

#### 4. **Content Job Metrics** (Monitoring)
```bash
# Adds performance tracking
supabase db push --file supabase/migrations/20251016120000_add_content_job_metrics.sql
```

**What it adds:**
- ✅ Performance metrics
- ✅ Success/failure rates
- ✅ Processing time tracking
- ✅ Queue depth monitoring

---

### Phase 2: RPC Functions (Helper Functions)

These create stored procedures used by edge functions:

#### 5. **Update Task By ID RPC** (Critical)
```bash
# Allows updating tasks with dynamic fields
supabase db push --file supabase/migrations/20251014_create_update_task_by_id_rpc.sql
```

**What it creates:**
```sql
CREATE OR REPLACE FUNCTION update_task_by_id(
  p_task_id TEXT,
  p_update_data JSONB
) RETURNS BOOLEAN
```

**Used by:**
- `generate-side-by-side` - Updates task with HTML/schema
- `update-task-status` - Updates any task fields
- All content workers

---

#### 6. **Task Query RPCs** (Convenience)
```bash
# Helper functions for task queries
supabase db push --file supabase/migrations/20251014_create_task_query_rpcs.sql
```

**What it creates:**
- `get_latest_task_by_outline_guid()` - Get most recent task
- `get_tasks_by_status()` - Query by status
- Other task query helpers

---

#### 7. **Content Plan Helper RPCs** (Optional but Recommended)
```bash
# Helpers for content plan operations
supabase db push --file supabase/migrations/20251014_create_content_plan_helper_rpcs.sql
```

**What it creates:**
- Content plan query helpers
- Outline management functions

---

#### 8. **Save Outline RPC** (If using outline generation)
```bash
# For outline storage/updates
supabase db push --file supabase/migrations/20251014_create_save_outline_rpc.sql
```

---

### Phase 3: Content Dispatcher (Orchestration)

If you're using the content dispatcher for queue management:

#### 9. **Content Dispatcher** (Advanced)
```bash
# Intelligent job routing and load balancing
supabase db push --file supabase/migrations/20251020120000_content_dispatcher.sql
```

**What it adds:**
- ✅ Intelligent job routing
- ✅ Load balancing across workers
- ✅ Priority queue management
- ✅ Worker health tracking

**Optional:** Only needed if using orchestrated content pipeline

---

### Phase 4: Additional Integrations (As Needed)

These are optional based on your features:

#### 10. **Hero Image Support** (If using hero images)
```bash
# For hero image generation/storage
supabase db push --file supabase/migrations/20250919_hero_helper_updates.sql
supabase db push --file supabase/migrations/20250919_hero_image_cleanup.sql
supabase db push --file supabase/migrations/20250919_hero_image_pg_net_triggers.sql
```

#### 11. **Outline Generation** (If using outlines)
```bash
# Creates outline-related tables and functions
supabase db push --file supabase/functions/setup-outline-generation-tables.sql
```

#### 12. **Synopsis Pipeline** (If using synopsis features)
```bash
# Only if using synopsis/scraping features
supabase db push --file supabase/migrations/20250701120000_create_synopsis_tables.sql
supabase db push --file supabase/migrations/20251003_synopsis_fast_pipeline.sql
```

---

## 🔧 Manual SQL Files (Function Directory)

Some SQL files in `/supabase/functions/` need to be run manually:

### Core Database Setup
```bash
# Run these if setting up from scratch:
psql $DATABASE_URL -f supabase/functions/database-setup.sql
psql $DATABASE_URL -f supabase/functions/database-triggers.sql
```

**What they create:**
- RLS policies for tables
- Basic trigger functions
- Helper stored procedures

---

## ✅ Verification Steps

After running migrations, verify setup:

### 1. Check Tables Exist
```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name LIKE 'content%'
ORDER BY table_name;
```

**Expected tables:**
- `content_jobs`
- `content_payloads`
- `content_job_events`
- `content_assets`
- `content_job_stages`

### 2. Check Queues Exist
```sql
SELECT * FROM pgmq.list_queues();
```

**Expected queues:**
- `content`
- `schema`
- `tsv`

### 3. Check RPC Functions
```sql
SELECT proname 
FROM pg_proc 
WHERE proname LIKE '%task%' 
   OR proname LIKE '%content%'
ORDER BY proname;
```

**Expected functions:**
- `update_task_by_id`
- `enqueue_stage`
- `dequeue_stage`
- `archive_message`

### 4. Test Basic Flow
```sql
-- Test creating a content job
INSERT INTO content_jobs (job_type, payload) 
VALUES ('test', '{"test": true}'::jsonb)
RETURNING id;

-- Check it was created
SELECT * FROM v_content_job_status 
WHERE job_type = 'test';
```

---

## 🚨 Common Issues & Solutions

### Issue 1: PGMQ Extension Missing

**Error:** `extension "pgmq" is not available`

**Solution:**
```sql
-- Enable PGMQ extension first
CREATE EXTENSION IF NOT EXISTS pgmq;
```

Or contact Supabase support to enable PGMQ on your project.

---

### Issue 2: Migration Already Applied

**Error:** `relation "content_jobs" already exists`

**Solution:**
This is fine - migration is already applied. Skip to next migration.

---

### Issue 3: Function Conflicts

**Error:** `function update_task_by_id already exists`

**Solution:**
```sql
-- Drop and recreate
DROP FUNCTION IF EXISTS update_task_by_id CASCADE;
-- Then re-run migration
```

---

### Issue 4: Permission Errors

**Error:** `permission denied for table content_jobs`

**Solution:**
```sql
-- Grant permissions to service role
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;
```

---

## 📊 Migration Summary Table

| Priority | Migration | Purpose | Required For |
|----------|-----------|---------|--------------|
| 🔴 CRITICAL | `20250919_content_jobs.sql` | Core job infrastructure | All content functions |
| 🔴 CRITICAL | `20250919_create_content_queue.sql` | PGMQ queues | Queue-based processing |
| 🟡 HIGH | `20251014_create_update_task_by_id_rpc.sql` | Task updates | generate-side-by-side, update-task-status |
| 🟡 HIGH | `20251016112651_content_queue_hardening.sql` | Stability | Production reliability |
| 🟢 MEDIUM | `20251016120000_add_content_job_metrics.sql` | Monitoring | Performance tracking |
| 🟢 MEDIUM | `20251014_create_task_query_rpcs.sql` | Helpers | Convenience functions |
| ⚪ LOW | `20251020120000_content_dispatcher.sql` | Orchestration | Advanced routing |
| ⚪ LOW | Hero image migrations | Images | Hero image features |
| ⚪ LOW | Synopsis migrations | Scraping | Synopsis features |

---

## 🚀 Quick Start (Minimal Setup)

For just getting content generation working:

```bash
# 1. Core infrastructure
supabase db push --file supabase/migrations/20250919_content_jobs.sql

# 2. Queue setup
supabase db push --file supabase/migrations/20250919_create_content_queue.sql

# 3. Task update function (critical for generate-side-by-side)
supabase db push --file supabase/migrations/20251014_create_update_task_by_id_rpc.sql

# 4. Queue hardening (recommended)
supabase db push --file supabase/migrations/20251016112651_content_queue_hardening.sql

# Done! Test your functions.
```

---

## 📝 Testing Your Setup

After migrations, test with a simple content job:

```python
import requests

# Create a test content job
response = requests.post(
    "https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/content-intake",
    headers={"Content-Type": "application/json"},
    json={
        "outline_guid": "test-outline-guid",
        "priority": 1
    }
)

print(f"Job created: {response.json()}")
```

---

## 🔗 Related Documentation

- [Content Worker Functions](./supabase/functions/README_EDGE_FUNCTIONS.md)
- [Generate Side-by-Side Python Guide](./GENERATE-SIDE-BY-SIDE-PYTHON.md)
- [SEO Functions Bug Fix](./SEO-FUNCTIONS-BUG-FIX.md)
- [Crawl Enhanced Deployment](./CRAWL-ENHANCED-DEPLOYMENT.md)

---

## 📞 Support

If migrations fail or you encounter issues:

1. Check Supabase dashboard for error logs
2. Verify PGMQ extension is enabled
3. Ensure service role has proper permissions
4. Review the migration file for dependencies

---

**Last Updated:** October 16, 2025  
**Migration Schema Version:** v5.0  
**Status:** ✅ Tested and Verified

