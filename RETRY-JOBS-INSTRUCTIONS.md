# How to Retry Failed Outline Jobs

## Failed Jobs to Retry

1. **ca604ff0-7195-4ec6-b5de-f417344cb34f** - "What Is FAFSA? A Step-by-Step Overview of the Application Process" (what is fafsa)
2. **7803d76a-ae6f-4db6-8fb3-125096ca41b4** - "Financial Aid 101: Everything You Need to Know About FAFSA" (financial aid)
3. **1935c137-0cfc-4344-9c91-2449c98571cc** - "What Is FAFSA? A Step-by-Step Overview of the Application Process" (what is fafsa)

## Method 1: Using the Node.js Script (Recommended)

1. Get your Supabase Service Role Key from: https://supabase.com/dashboard/project/jsypctdhynsdqrfifvdh/settings/api

2. Run the script:
```bash
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here node retry-jobs.mjs
```

## Method 2: Manual via Supabase Dashboard

### Step 1: Reset Job Status (SQL Editor)
Run this in the Supabase SQL Editor:

```sql
UPDATE outline_generation_jobs
SET
  status = 'pending',
  updated_at = NOW(),
  attempts = 0,
  heartbeat_at = NULL
WHERE id IN (
  'ca604ff0-7195-4ec6-b5de-f417344cb34f',
  '7803d76a-ae6f-4db6-8fb3-125096ca41b4',
  '1935c137-0cfc-4344-9c91-2449c98571cc'
);
```

### Step 2: Trigger Jobs (Edge Functions Logs)

Go to Edge Functions > fast-outline-search and invoke with:

**Job 1:**
```json
{
  "job_id": "ca604ff0-7195-4ec6-b5de-f417344cb34f"
}
```

**Job 2:**
```json
{
  "job_id": "7803d76a-ae6f-4db6-8fb3-125096ca41b4"
}
```

**Job 3:**
```json
{
  "job_id": "1935c137-0cfc-4344-9c91-2449c98571cc"
}
```

## Method 3: Using cURL

```bash
# Set your service role key
export SUPABASE_SERVICE_KEY="your_service_role_key_here"

# Job 1
curl -X POST https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/fast-outline-search \
  -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"job_id": "ca604ff0-7195-4ec6-b5de-f417344cb34f"}'

# Job 2
curl -X POST https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/fast-outline-search \
  -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"job_id": "7803d76a-ae6f-4db6-8fb3-125096ca41b4"}'

# Job 3
curl -X POST https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/fast-outline-search \
  -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"job_id": "1935c137-0cfc-4344-9c91-2449c98571cc"}'
```

## Check Job Status

```sql
SELECT
  id,
  post_keyword,
  status,
  updated_at,
  attempts
FROM outline_generation_jobs
WHERE id IN (
  'ca604ff0-7195-4ec6-b5de-f417344cb34f',
  '7803d76a-ae6f-4db6-8fb3-125096ca41b4',
  '1935c137-0cfc-4344-9c91-2449c98571cc'
)
ORDER BY updated_at DESC;
```

## Monitor Progress

Check the status updates in the `content_plan_outline_statuses` table:

```sql
SELECT
  outline_guid,
  status,
  created_at
FROM content_plan_outline_statuses
WHERE outline_guid IN (
  'ca604ff0-7195-4ec6-b5de-f417344cb34f',
  '7803d76a-ae6f-4db6-8fb3-125096ca41b4',
  '1935c137-0cfc-4344-9c91-2449c98571cc'
)
ORDER BY outline_guid, created_at DESC;
```
