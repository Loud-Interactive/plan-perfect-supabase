# Content Migrations - Quick Reference

## 🚀 Quick Start (Minimal Setup)

Run these in order for basic content generation:

```bash
# 1. Core Infrastructure (MUST RUN FIRST)
supabase db push --file supabase/migrations/20250919_content_jobs.sql

# 2. Queue Setup (MUST RUN SECOND)
supabase db push --file supabase/migrations/20250919_create_content_queue.sql

# 3. Task Update Function (CRITICAL for generate-side-by-side)
supabase db push --file supabase/migrations/20251014_create_update_task_by_id_rpc.sql

# 4. Queue Hardening (RECOMMENDED)
supabase db push --file supabase/migrations/20251016112651_content_queue_hardening.sql

# ✅ Done! You can now use content generation functions
```

---

## 🎯 Or Use the Automated Script

```bash
# Interactive script that runs migrations in order
./run-content-migrations.sh
```

---

## 📋 What Each Migration Does

### 1. `20250919_content_jobs.sql` ✅ REQUIRED
Creates:
- `content_jobs` table
- `content_payloads` table
- `content_job_events` table
- `content_assets` table
- `content_job_stages` table
- Helper functions

### 2. `20250919_create_content_queue.sql` ✅ REQUIRED
Creates:
- `content` queue
- `schema` queue  
- `tsv` queue

### 3. `20251014_create_update_task_by_id_rpc.sql` ✅ REQUIRED
Creates:
- `update_task_by_id()` function

**Used by:**
- `generate-side-by-side`
- `update-task-status`
- All content workers

### 4. `20251016112651_content_queue_hardening.sql` 🟡 RECOMMENDED
Adds:
- Error handling
- Retry logic
- Monitoring

---

## ⚠️ Prerequisites

1. **PGMQ Extension** - Required for queue management
   ```sql
   CREATE EXTENSION IF NOT EXISTS pgmq;
   ```

2. **Service Role Permissions**
   ```sql
   GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
   GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;
   ```

---

## ✅ Verify Setup

```sql
-- Check tables exist
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' AND table_name LIKE 'content%';

-- Check queues exist
SELECT * FROM pgmq.list_queues();

-- Check RPC function exists
SELECT proname FROM pg_proc WHERE proname = 'update_task_by_id';
```

---

## 🔧 Quick Troubleshooting

**"PGMQ extension not found"**
→ Contact Supabase support to enable PGMQ

**"Table already exists"**
→ Migration already applied, skip it

**"Permission denied"**
→ Run the service role permissions grants above

---

## 📚 Full Documentation

See `CONTENT-GENERATION-MIGRATIONS-GUIDE.md` for:
- Complete migration details
- Advanced options
- Optional features
- Testing procedures

---

**Updated:** October 16, 2025  
**Minimal Setup:** 4 migrations  
**Time Required:** ~2-5 minutes

