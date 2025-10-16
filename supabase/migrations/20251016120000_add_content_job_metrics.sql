-- Migration: Add observability, metrics, and health check infrastructure for PlanPerfect pipeline

-- ========================================
-- 1. Create content_job_metrics table for aggregated metrics
-- ========================================
create table if not exists public.content_job_metrics (
  id bigserial primary key,
  job_id uuid,
  stage text not null,
  metric_type text not null, -- 'duration', 'failure', 'queue_depth', 'attempt'
  metric_value numeric not null,
  message_id bigint,
  attempt_count integer,
  priority integer,
  metadata jsonb default '{}'::jsonb,
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.content_job_metrics is 'Aggregated metrics for content job pipeline observability';
comment on column public.content_job_metrics.metric_type is 'Type of metric: duration, failure, queue_depth, attempt';
comment on column public.content_job_metrics.metric_value is 'Numeric value of the metric (milliseconds for duration, count for others)';
comment on column public.content_job_metrics.message_id is 'Associated queue message ID if applicable';
comment on column public.content_job_metrics.attempt_count is 'Attempt number when metric was recorded';
comment on column public.content_job_metrics.priority is 'Job priority when metric was recorded';
comment on column public.content_job_metrics.metadata is 'Additional contextual metadata';

-- Indexes for efficient querying
create index if not exists content_job_metrics_job_id_idx 
  on public.content_job_metrics (job_id);

create index if not exists content_job_metrics_stage_idx 
  on public.content_job_metrics (stage);

create index if not exists content_job_metrics_metric_type_idx 
  on public.content_job_metrics (metric_type);

create index if not exists content_job_metrics_recorded_at_idx 
  on public.content_job_metrics (recorded_at desc);

create index if not exists content_job_metrics_stage_type_recorded_idx 
  on public.content_job_metrics (stage, metric_type, recorded_at desc);

-- ========================================
-- 2. Create materialized view for fast aggregated metrics access
-- ========================================
create materialized view if not exists public.v_content_metrics_summary as
select
  stage,
  metric_type,
  count(*) as metric_count,
  avg(metric_value) as avg_value,
  min(metric_value) as min_value,
  max(metric_value) as max_value,
  percentile_cont(0.5) within group (order by metric_value) as p50_value,
  percentile_cont(0.95) within group (order by metric_value) as p95_value,
  percentile_cont(0.99) within group (order by metric_value) as p99_value,
  date_trunc('hour', recorded_at) as time_bucket
from public.content_job_metrics
where recorded_at >= now() - interval '7 days'
group by stage, metric_type, date_trunc('hour', recorded_at);

create unique index if not exists v_content_metrics_summary_unique_idx
  on public.v_content_metrics_summary (stage, metric_type, time_bucket);

create index if not exists v_content_metrics_summary_stage_idx
  on public.v_content_metrics_summary (stage);

create index if not exists v_content_metrics_summary_time_idx
  on public.v_content_metrics_summary (time_bucket desc);

comment on materialized view public.v_content_metrics_summary is 
  'Hourly aggregated metrics summary for the last 7 days - refresh periodically for performance';

-- ========================================
-- 3. Create function to refresh metrics summary
-- ========================================
create or replace function public.refresh_content_metrics_summary()
returns void
language plpgsql
security definer
as $$$
begin
  refresh materialized view concurrently public.v_content_metrics_summary;
end;
$$;

comment on function public.refresh_content_metrics_summary is 
  'Refresh the materialized view of content metrics summary';

-- ========================================
-- 4. Create helper function to record metrics
-- ========================================
create or replace function public.record_job_metric(
  p_job_id uuid,
  p_stage text,
  p_metric_type text,
  p_metric_value numeric,
  p_message_id bigint default null,
  p_attempt_count integer default null,
  p_priority integer default null,
  p_metadata jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
as $$$
declare
  v_metric_id bigint;
begin
  insert into public.content_job_metrics (
    job_id,
    stage,
    metric_type,
    metric_value,
    message_id,
    attempt_count,
    priority,
    metadata,
    recorded_at
  ) values (
    p_job_id,
    p_stage,
    p_metric_type,
    p_metric_value,
    p_message_id,
    p_attempt_count,
    p_priority,
    p_metadata,
    now()
  )
  returning id into v_metric_id;
  
  return v_metric_id;
end;
$$;

comment on function public.record_job_metric is 
  'Record a metric event for observability and monitoring';

-- ========================================
-- 5. Create view for queue depth monitoring
-- ========================================
create or replace view public.v_queue_health as
select
  'content' as queue_name,
  coalesce(count(*) filter (where status = 'queued'), 0) as queued_count,
  coalesce(count(*) filter (where status = 'processing'), 0) as processing_count,
  coalesce(count(*) filter (where status = 'error'), 0) as error_count,
  coalesce(count(*) filter (where status = 'failed'), 0) as failed_count,
  coalesce(count(*) filter (where dead_lettered_at is not null), 0) as dead_letter_count,
  min(case when status = 'queued' then available_at end) as oldest_queued_at,
  max(case when status = 'processing' then last_dequeued_at end) as latest_processing_at,
  now() as snapshot_at
from public.content_job_stages;

comment on view public.v_queue_health is 
  'Real-time view of queue health metrics across all stages';

-- ========================================
-- 6. Create function to capture queue depth snapshot
-- ========================================
create or replace function public.capture_queue_depth_snapshot()
returns void
language plpgsql
as $$$
declare
  v_stage_record record;
begin
  for v_stage_record in
    select 
      stage,
      count(*) filter (where status = 'queued') as queued_count,
      count(*) filter (where status = 'processing') as processing_count,
      count(*) filter (where status = 'error') as error_count
    from public.content_job_stages
    where status in ('queued', 'processing', 'error')
    group by stage
  loop
    -- Record queue depth as metrics
    if v_stage_record.queued_count > 0 then
      perform public.record_job_metric(
        gen_random_uuid(), -- use random uuid for aggregate metrics
        v_stage_record.stage,
        'queue_depth',
        v_stage_record.queued_count,
        null,
        null,
        null,
        jsonb_build_object('status', 'queued')
      );
    end if;
    
    if v_stage_record.processing_count > 0 then
      perform public.record_job_metric(
        gen_random_uuid(),
        v_stage_record.stage,
        'queue_depth',
        v_stage_record.processing_count,
        null,
        null,
        null,
        jsonb_build_object('status', 'processing')
      );
    end if;
    
    if v_stage_record.error_count > 0 then
      perform public.record_job_metric(
        gen_random_uuid(),
        v_stage_record.stage,
        'queue_depth',
        v_stage_record.error_count,
        null,
        null,
        null,
        jsonb_build_object('status', 'error')
      );
    end if;
  end loop;
end;
$$;

comment on function public.capture_queue_depth_snapshot is 
  'Capture a snapshot of queue depths for all stages - run periodically via cron';

-- ========================================
-- 7. Backfill stage duration metrics from existing data
-- ========================================
insert into public.content_job_metrics (
  job_id,
  stage,
  metric_type,
  metric_value,
  attempt_count,
  priority,
  metadata,
  recorded_at
)
select
  job_id,
  stage,
  'duration',
  extract(epoch from (finished_at - started_at)) * 1000 as duration_ms,
  attempt_count,
  priority,
  jsonb_build_object(
    'status', status,
    'backfilled', true
  ),
  finished_at
from public.content_job_stages
where finished_at is not null
  and started_at is not null
  and status in ('completed', 'failed')
on conflict do nothing;

-- Backfill failure count metrics
insert into public.content_job_metrics (
  job_id,
  stage,
  metric_type,
  metric_value,
  attempt_count,
  priority,
  metadata,
  recorded_at
)
select
  job_id,
  stage,
  'failure',
  1,
  attempt_count,
  priority,
  jsonb_build_object(
    'status', status,
    'error', last_error,
    'backfilled', true
  ),
  finished_at
from public.content_job_stages
where status = 'failed'
  and finished_at is not null
on conflict do nothing;

-- ========================================
-- 8. Create function to get health check status
-- ========================================
create or replace function public.get_pipeline_health_status(
  p_duration_threshold_ms numeric default 300000,    -- 5 minutes
  p_error_rate_threshold numeric default 0.1,       -- 10%
  p_queue_depth_threshold integer default 100
)
returns jsonb
language plpgsql
as $$$
declare
  v_health jsonb := '{}'::jsonb;
  v_alerts jsonb := '[]'::jsonb;
  v_stage_record record;
  v_duration_p95 numeric;
  v_error_rate numeric;
  v_queue_depth integer;
  v_status text := 'healthy';
begin
  -- Check each stage
  for v_stage_record in
    select distinct stage from public.content_job_stages
  loop
    -- Check P95 duration
    select percentile_cont(0.95) within group (order by metric_value)
    into v_duration_p95
    from public.content_job_metrics
    where stage = v_stage_record.stage
      and metric_type = 'duration'
      and recorded_at >= now() - interval '1 hour';
    
    if v_duration_p95 > p_duration_threshold_ms then
      v_alerts := v_alerts || jsonb_build_object(
        'stage', v_stage_record.stage,
        'type', 'high_duration',
        'value', v_duration_p95,
        'threshold', p_duration_threshold_ms,
        'severity', 'warning'
      );
      v_status := 'degraded';
    end if;
    
    -- Check error rate
    select 
      case 
        when count(*) > 0 then
          count(*) filter (where metric_type = 'failure')::numeric / count(*)::numeric
        else 0
      end
    into v_error_rate
    from public.content_job_metrics
    where stage = v_stage_record.stage
      and recorded_at >= now() - interval '1 hour';
    
    if v_error_rate > p_error_rate_threshold then
      v_alerts := v_alerts || jsonb_build_object(
        'stage', v_stage_record.stage,
        'type', 'high_error_rate',
        'value', v_error_rate,
        'threshold', p_error_rate_threshold,
        'severity', 'critical'
      );
      v_status := 'unhealthy';
    end if;
    
    -- Check queue depth
    select count(*)
    into v_queue_depth
    from public.content_job_stages
    where stage = v_stage_record.stage
      and status = 'queued';
    
    if v_queue_depth > p_queue_depth_threshold then
      v_alerts := v_alerts || jsonb_build_object(
        'stage', v_stage_record.stage,
        'type', 'high_queue_depth',
        'value', v_queue_depth,
        'threshold', p_queue_depth_threshold,
        'severity', 'warning'
      );
      if v_status = 'healthy' then
        v_status := 'degraded';
      end if;
    end if;
  end loop;
  
  v_health := jsonb_build_object(
    'status', v_status,
    'timestamp', now(),
    'alerts', v_alerts,
    'alert_count', jsonb_array_length(v_alerts)
  );
  
  return v_health;
end;
$$;

comment on function public.get_pipeline_health_status is 
  'Check pipeline health against configurable thresholds and return status with alerts';

-- ========================================
-- 9. Dispatch alerts via pg_net.webhook with HTTP fallback
-- ========================================
create or replace function public.pg_net_webhook(
  webhook_name text,
  payload jsonb,
  fallback_url text default null,
  headers jsonb default '{}'::jsonb,
  timeout_ms integer default 5000
)
returns boolean
language plpgsql
as $$
declare
  v_headers jsonb := coalesce(headers, '{}'::jsonb);
  v_payload jsonb := coalesce(payload, '{}'::jsonb) || jsonb_build_object('timestamp', now());
begin
  if coalesce(webhook_name, '') = '' then
    raise notice 'pg_net_webhook called without webhook_name';
    -- Attempt fallback immediately if configured
    if fallback_url is not null then
      begin
        perform net.http_post(
          url := fallback_url,
          headers := v_headers,
          body := v_payload::text,
          timeout_milliseconds := timeout_ms
        );
        return true;
      exception
        when others then
          raise notice 'Fallback http_post failed: %', sqlerrm;
          return false;
      end;
    end if;
    return false;
  end if;

  begin
    execute 'select pg_net.webhook($1, $2)' using webhook_name, v_payload;
    return true;
  exception
    when undefined_function then
      raise notice 'pg_net.webhook not available, attempting fallback';
    when others then
      raise notice 'pg_net.webhook call failed: %', sqlerrm;
  end;

  if fallback_url is not null then
    begin
      perform net.http_post(
        url := fallback_url,
        headers := v_headers,
        body := v_payload::text,
        timeout_milliseconds := timeout_ms
      );
      return true;
    exception
      when others then
        raise notice 'Fallback http_post failed: %', sqlerrm;
        return false;
    end;
  end if;

  return false;
end;
$$;

comment on function public.pg_net_webhook is
  'Dispatch alerts via pg_net.webhook with optional HTTP fallback for observability alerts';
