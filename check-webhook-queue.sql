-- Check if webhook was queued for the task we just updated
SELECT 
  id,
  event_type,
  domain,
  processed,
  created_at,
  payload->>'task_id' as task_id,
  payload->>'status' as status
FROM webhook_events_queue
WHERE payload->>'task_id' = 'd3bf1bd5-af5b-4707-952a-41cdc81916ec'
ORDER BY created_at DESC
LIMIT 5;

-- Also check all recent webhook events
SELECT 
  event_type,
  domain,
  processed,
  created_at,
  payload->>'task_id' as task_id
FROM webhook_events_queue
ORDER BY created_at DESC
LIMIT 10;

