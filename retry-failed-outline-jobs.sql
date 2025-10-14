-- Retry failed outline generation jobs
-- Reset status to pending so they can be reprocessed

BEGIN;

-- Reset the three failed jobs to pending status
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
)
RETURNING id, post_keyword, status, updated_at;

COMMIT;

-- Now you need to trigger fast-outline-search for each job
-- Run these in the Supabase dashboard or via API:
/*
curl -X POST https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/fast-outline-search \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"job_id": "ca604ff0-7195-4ec6-b5de-f417344cb34f"}'

curl -X POST https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/fast-outline-search \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"job_id": "7803d76a-ae6f-4db6-8fb3-125096ca41b4"}'

curl -X POST https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/fast-outline-search \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"job_id": "1935c137-0cfc-4344-9c91-2449c98571cc"}'
*/
