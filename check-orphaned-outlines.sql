-- Find orphaned content_plan_outlines records
SELECT
  COUNT(*) as orphaned_count
FROM content_plan_outlines cpo
LEFT JOIN content_plans cp ON cpo.content_plan_guid = cp.guid
WHERE cp.guid IS NULL;

-- Show first 10 orphaned records
SELECT
  cpo.guid,
  cpo.content_plan_guid,
  cpo.post_title,
  cpo.created_at
FROM content_plan_outlines cpo
LEFT JOIN content_plans cp ON cpo.content_plan_guid = cp.guid
WHERE cp.guid IS NULL
ORDER BY cpo.created_at DESC
LIMIT 10;
