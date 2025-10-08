-- PagePerfect 2.0 Performance Monitoring Views (Fixed)
-- This migration creates views for monitoring batch processing performance

-- Main performance view with detailed metrics
CREATE OR REPLACE VIEW pp_batch_performance AS
WITH stage_timing AS (
  SELECT 
    pp_batch_id,
    AVG(EXTRACT(EPOCH FROM (processing_end - processing_start))) as avg_duration_seconds,
    MIN(EXTRACT(EPOCH FROM (processing_end - processing_start))) as min_duration_seconds,
    MAX(EXTRACT(EPOCH FROM (processing_end - processing_start))) as max_duration_seconds,
    COUNT(*) as total_processed,
    COUNT(*) FILTER (WHERE success = true) as successful,
    COUNT(*) FILTER (WHERE success = false) as failed,
    COUNT(*) FILTER (WHERE processing_end IS NULL) as in_progress
  FROM seo_processing_tracking
  WHERE pp_batch_id IS NOT NULL
  GROUP BY pp_batch_id
),
batch_domains AS (
  SELECT 
    t.pp_batch_id,
    COUNT(DISTINCT p.domain) as unique_domains,
    jsonb_object_agg(
      p.domain, 
      domain_count
    ) FILTER (WHERE p.domain IS NOT NULL) as domain_breakdown
  FROM (
    SELECT 
      t.pp_batch_id,
      p.domain,
      COUNT(*) as domain_count
    FROM seo_processing_tracking t
    JOIN pages p ON p.id = (
      SELECT page_id FROM crawl_jobs WHERE id = t.job_id LIMIT 1
    )
    WHERE t.pp_batch_id IS NOT NULL
    GROUP BY t.pp_batch_id, p.domain
  ) t
  JOIN pages p ON p.domain = t.domain
  GROUP BY t.pp_batch_id
)
SELECT 
  b.id as batch_id,
  b.name as batch_name,
  b.user_id,
  b.status,
  b.total_urls,
  b.processed_urls,
  b.failed_urls,
  b.created_at,
  b.completed_at,
  EXTRACT(EPOCH FROM (COALESCE(b.completed_at, NOW()) - b.created_at)) as total_duration_seconds,
  st.avg_duration_seconds as avg_url_duration_seconds,
  st.min_duration_seconds as min_url_duration_seconds,
  st.max_duration_seconds as max_url_duration_seconds,
  st.total_processed as urls_attempted,
  st.successful as urls_successful,
  st.failed as urls_failed,
  st.in_progress as urls_in_progress,
  CASE 
    WHEN st.total_processed > 0 
    THEN (st.successful::FLOAT / st.total_processed * 100)
    ELSE 0 
  END as success_rate_percentage,
  CASE 
    WHEN EXTRACT(EPOCH FROM (COALESCE(b.completed_at, NOW()) - b.created_at)) > 0
    THEN st.total_processed / (EXTRACT(EPOCH FROM (COALESCE(b.completed_at, NOW()) - b.created_at)) / 60)
    ELSE 0
  END as urls_per_minute,
  bd.unique_domains,
  bd.domain_breakdown,
  b.metadata
FROM pp_batch_jobs b
LEFT JOIN stage_timing st ON st.pp_batch_id = b.id
LEFT JOIN batch_domains bd ON bd.pp_batch_id = b.id;

-- Simpler version without domain breakdown to avoid nested aggregates
CREATE OR REPLACE VIEW pp_batch_performance_simple AS
WITH stage_timing AS (
  SELECT 
    pp_batch_id,
    AVG(EXTRACT(EPOCH FROM (processing_end - processing_start))) as avg_duration_seconds,
    MIN(EXTRACT(EPOCH FROM (processing_end - processing_start))) as min_duration_seconds,
    MAX(EXTRACT(EPOCH FROM (processing_end - processing_start))) as max_duration_seconds,
    COUNT(*) as total_processed,
    COUNT(*) FILTER (WHERE success = true) as successful,
    COUNT(*) FILTER (WHERE success = false) as failed,
    COUNT(*) FILTER (WHERE processing_end IS NULL) as in_progress
  FROM seo_processing_tracking
  WHERE pp_batch_id IS NOT NULL
  GROUP BY pp_batch_id
),
domain_counts AS (
  SELECT 
    t.pp_batch_id,
    COUNT(DISTINCT p.domain) as unique_domains
  FROM seo_processing_tracking t
  JOIN crawl_jobs cj ON cj.id = t.job_id
  JOIN pages p ON p.id = cj.page_id
  WHERE t.pp_batch_id IS NOT NULL
  GROUP BY t.pp_batch_id
)
SELECT 
  b.id as batch_id,
  b.name as batch_name,
  b.user_id,
  b.status,
  b.total_urls,
  b.processed_urls,
  b.failed_urls,
  b.created_at,
  b.completed_at,
  EXTRACT(EPOCH FROM (COALESCE(b.completed_at, NOW()) - b.created_at)) as total_duration_seconds,
  st.avg_duration_seconds as avg_url_duration_seconds,
  st.min_duration_seconds as min_url_duration_seconds,
  st.max_duration_seconds as max_url_duration_seconds,
  st.total_processed as urls_attempted,
  st.successful as urls_successful,
  st.failed as urls_failed,
  st.in_progress as urls_in_progress,
  CASE 
    WHEN st.total_processed > 0 
    THEN (st.successful::FLOAT / st.total_processed * 100)
    ELSE 0 
  END as success_rate_percentage,
  CASE 
    WHEN EXTRACT(EPOCH FROM (COALESCE(b.completed_at, NOW()) - b.created_at)) > 0
    THEN st.total_processed / (EXTRACT(EPOCH FROM (COALESCE(b.completed_at, NOW()) - b.created_at)) / 60)
    ELSE 0
  END as urls_per_minute,
  dc.unique_domains,
  b.metadata
FROM pp_batch_jobs b
LEFT JOIN stage_timing st ON st.pp_batch_id = b.id
LEFT JOIN domain_counts dc ON dc.pp_batch_id = b.id;

-- Domain breakdown as a separate view
CREATE OR REPLACE VIEW pp_batch_domains AS
SELECT 
  t.pp_batch_id as batch_id,
  p.domain,
  COUNT(*) as url_count,
  COUNT(*) FILTER (WHERE t.success = true) as successful,
  COUNT(*) FILTER (WHERE t.success = false) as failed,
  COUNT(*) FILTER (WHERE t.processing_end IS NULL) as in_progress,
  AVG(EXTRACT(EPOCH FROM (t.processing_end - t.processing_start))) FILTER (WHERE t.processing_end IS NOT NULL) as avg_duration_seconds
FROM seo_processing_tracking t
JOIN crawl_jobs cj ON cj.id = t.job_id
JOIN pages p ON p.id = cj.page_id
WHERE t.pp_batch_id IS NOT NULL
AND p.domain IS NOT NULL
GROUP BY t.pp_batch_id, p.domain;

-- Hourly performance aggregation
CREATE OR REPLACE VIEW pp_hourly_performance AS
SELECT 
  date_trunc('hour', b.created_at) as hour,
  COUNT(DISTINCT b.id) as batches_started,
  SUM(b.total_urls) as total_urls_submitted,
  SUM(b.processed_urls) as total_urls_processed,
  SUM(b.failed_urls) as total_urls_failed,
  AVG(CASE 
    WHEN b.status = 'completed' AND b.processed_urls > 0
    THEN b.processed_urls::FLOAT / NULLIF(b.total_urls, 0) * 100
    ELSE NULL
  END) as avg_completion_rate,
  AVG(CASE
    WHEN b.status = 'completed'
    THEN EXTRACT(EPOCH FROM (b.completed_at - b.created_at)) / 60
    ELSE NULL
  END) as avg_batch_duration_minutes
FROM pp_batch_jobs b
WHERE b.created_at >= NOW() - INTERVAL '7 days'
GROUP BY date_trunc('hour', b.created_at)
ORDER BY hour DESC;

-- User performance summary
CREATE OR REPLACE VIEW pp_user_performance AS
SELECT 
  u.id as user_id,
  u.email as user_email,
  COUNT(DISTINCT b.id) as total_batches,
  SUM(b.total_urls) as total_urls_submitted,
  SUM(b.processed_urls) as total_urls_processed,
  SUM(b.failed_urls) as total_urls_failed,
  AVG(CASE 
    WHEN b.status = 'completed' AND b.processed_urls > 0
    THEN b.processed_urls::FLOAT / NULLIF(b.total_urls, 0) * 100
    ELSE NULL
  END) as avg_success_rate,
  MAX(b.created_at) as last_batch_created,
  SUM(b.total_urls * 4) as total_credits_used -- 4 credits per URL
FROM auth.users u
JOIN pp_batch_jobs b ON b.user_id = u.id
GROUP BY u.id, u.email;

-- Real-time system performance metrics
CREATE OR REPLACE VIEW pp_system_metrics AS
WITH current_load AS (
  SELECT 
    COUNT(*) FILTER (WHERE processing_end IS NULL) as active_jobs,
    COUNT(*) FILTER (WHERE processing_start > NOW() - INTERVAL '1 minute') as jobs_started_last_minute,
    COUNT(*) FILTER (WHERE processing_end > NOW() - INTERVAL '1 minute' AND success = true) as jobs_completed_last_minute,
    COUNT(*) FILTER (WHERE processing_end > NOW() - INTERVAL '1 minute' AND success = false) as jobs_failed_last_minute
  FROM seo_processing_tracking
  WHERE pp_batch_id IS NOT NULL
),
queue_depth AS (
  SELECT 
    COUNT(*) as pending_jobs
  FROM seo_processing_tracking
  WHERE pp_batch_id IS NOT NULL
  AND processing_start IS NULL
)
SELECT 
  cl.active_jobs,
  cl.jobs_started_last_minute,
  cl.jobs_completed_last_minute,
  cl.jobs_failed_last_minute,
  qd.pending_jobs,
  cl.jobs_started_last_minute as throughput_per_minute,
  CASE 
    WHEN cl.jobs_started_last_minute > 0 
    THEN (cl.jobs_failed_last_minute::FLOAT / cl.jobs_started_last_minute * 100)
    ELSE 0 
  END as error_rate_percentage,
  NOW() as measured_at
FROM current_load cl, queue_depth qd;

-- Domain performance analysis
CREATE OR REPLACE VIEW pp_domain_performance AS
WITH domain_stats AS (
  SELECT 
    p.domain,
    COUNT(DISTINCT t.id) as total_jobs,
    COUNT(DISTINCT t.id) FILTER (WHERE t.success = true) as successful_jobs,
    COUNT(DISTINCT t.id) FILTER (WHERE t.success = false) as failed_jobs,
    AVG(EXTRACT(EPOCH FROM (t.processing_end - t.processing_start))) FILTER (WHERE t.processing_end IS NOT NULL) as avg_duration_seconds,
    MAX(t.processing_end) as last_processed
  FROM seo_processing_tracking t
  JOIN crawl_jobs cj ON cj.id = t.job_id
  JOIN pages p ON p.id = cj.page_id
  WHERE t.pp_batch_id IS NOT NULL
  AND p.domain IS NOT NULL
  GROUP BY p.domain
)
SELECT 
  domain,
  total_jobs,
  successful_jobs,
  failed_jobs,
  CASE 
    WHEN total_jobs > 0 
    THEN (successful_jobs::FLOAT / total_jobs * 100)
    ELSE 0 
  END as success_rate_percentage,
  avg_duration_seconds,
  last_processed
FROM domain_stats
WHERE total_jobs >= 10 -- Only show domains with meaningful data
ORDER BY total_jobs DESC;

-- Error analysis view
CREATE OR REPLACE VIEW pp_error_analysis AS
SELECT 
  error_message,
  COUNT(*) as error_count,
  COUNT(DISTINCT pp_batch_id) as affected_batches,
  MIN(processing_start) as first_occurred,
  MAX(processing_start) as last_occurred,
  array_agg(DISTINCT pp_batch_id) as batch_ids
FROM seo_processing_tracking
WHERE pp_batch_id IS NOT NULL
AND success = false
AND error_message IS NOT NULL
AND processing_start >= NOW() - INTERVAL '7 days'
GROUP BY error_message
ORDER BY error_count DESC;

-- Performance comparison view (current vs previous period)
CREATE OR REPLACE VIEW pp_performance_comparison AS
WITH current_period AS (
  SELECT 
    COUNT(DISTINCT id) as batches,
    SUM(total_urls) as urls,
    AVG(CASE 
      WHEN status = 'completed' AND processed_urls > 0
      THEN processed_urls::FLOAT / NULLIF(total_urls, 0) * 100
      ELSE NULL
    END) as success_rate
  FROM pp_batch_jobs
  WHERE created_at >= NOW() - INTERVAL '7 days'
),
previous_period AS (
  SELECT 
    COUNT(DISTINCT id) as batches,
    SUM(total_urls) as urls,
    AVG(CASE 
      WHEN status = 'completed' AND processed_urls > 0
      THEN processed_urls::FLOAT / NULLIF(total_urls, 0) * 100
      ELSE NULL
    END) as success_rate
  FROM pp_batch_jobs
  WHERE created_at >= NOW() - INTERVAL '14 days'
  AND created_at < NOW() - INTERVAL '7 days'
)
SELECT 
  'Last 7 days' as period,
  cp.batches,
  cp.urls,
  cp.success_rate
FROM current_period cp
UNION ALL
SELECT 
  'Previous 7 days' as period,
  pp.batches,
  pp.urls,
  pp.success_rate
FROM previous_period pp;

-- Grant select permissions on all views
GRANT SELECT ON pp_batch_performance_simple TO authenticated;
GRANT SELECT ON pp_batch_domains TO authenticated;
GRANT SELECT ON pp_hourly_performance TO authenticated;
GRANT SELECT ON pp_user_performance TO authenticated;
GRANT SELECT ON pp_system_metrics TO authenticated;
GRANT SELECT ON pp_domain_performance TO authenticated;
GRANT SELECT ON pp_error_analysis TO authenticated;
GRANT SELECT ON pp_performance_comparison TO authenticated;

-- Create indexes to improve view performance
CREATE INDEX IF NOT EXISTS idx_seo_processing_tracking_pp_batch_performance 
ON seo_processing_tracking(pp_batch_id, processing_start, processing_end, success) 
WHERE pp_batch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pages_domain 
ON pages(domain) 
WHERE domain IS NOT NULL;

-- Comments for documentation
COMMENT ON VIEW pp_batch_performance_simple IS 'Simplified performance metrics for each batch (without domain breakdown)';
COMMENT ON VIEW pp_batch_domains IS 'Domain-level breakdown for each batch';
COMMENT ON VIEW pp_hourly_performance IS 'Hourly aggregation of batch processing metrics for trend analysis';
COMMENT ON VIEW pp_user_performance IS 'User-level summary of batch processing activity and credit usage';
COMMENT ON VIEW pp_system_metrics IS 'Real-time system performance indicators for monitoring current load';
COMMENT ON VIEW pp_domain_performance IS 'Performance analysis broken down by domain to identify problematic sites';
COMMENT ON VIEW pp_error_analysis IS 'Error frequency and pattern analysis for troubleshooting';
COMMENT ON VIEW pp_performance_comparison IS 'Week-over-week performance comparison for trend tracking';