-- Content Queue Dispatcher infrastructure

-- Ensure required extensions are available
create extension if not exists pg_net with schema net;
create extension if not exists pg_cron;

-- Configuration table for stage level concurrency limits
create table if not exists public.content_stage_config (
  stage text primary key,
  queue text not null default 'content',
  worker_endpoint text not null,
  max_concurrency integer not null default 1,
  trigger_batch_size integer not null default 1,
  enabled boolean not null default true,
  last_updated_at timestamptz not null default now()
);

comment on table public.content_stage_config is 'Dispatcher configuration per PlanPerfect stage';
comment on column public.content_stage_config.stage is 'Stage name e.g. research, outline, draft, qa, export, complete';
comment on column public.content_stage_config.queue is 'Target pgmq queue to inspect (content/schema/etc)';
comment on column public.content_stage_config.worker_endpoint is 'Edge function endpoint that should be triggered for this stage';
comment on column public.content_stage_config.max_concurrency is 'Maximum number of concurrent workers permitted for the stage';
comment on column public.content_stage_config.trigger_batch_size is 'Number of workers to start per trigger invocation (usually 1)';
comment on column public.content_stage_config.enabled is 'Controls whether the dispatcher should attempt to schedule this stage';

-- Seed default configuration for core stages (idempotent)
insert into public.content_stage_config (stage, queue, worker_endpoint, max_concurrency, trigger_batch_size)
values
  ('research', 'content', 'https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/content-research-worker', 6, 1),
  ('outline', 'content', 'https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/content-outline-worker', 6, 1),
  ('draft', 'content', 'https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/content-draft-worker', 4, 1),
  ('qa', 'content', 'https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/content-qa-worker', 4, 1),
  ('export', 'content', 'https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/content-export-worker', 3, 1),
  ('complete', 'content', 'https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/content-complete-worker', 2, 1)
on conflict (stage) do update
set queue = excluded.queue,
    worker_endpoint = excluded.worker_endpoint,
    max_concurrency = excluded.max_concurrency,
    trigger_batch_size = excluded.trigger_batch_size,
    last_updated_at = now();

-- RPC to compute queue depth per stage (simplified)
-- Uses existing get_queue_depth RPC and aggregates with job_stages data
create or replace function public.get_content_stage_backlog()
returns table (
  stage text,
  ready_count bigint,
  inflight_count bigint
)
language plpgsql
as $$
begin
  return query
  select
    s.stage::text,
    count(*) filter (where s.status = 'queued' and s.available_at <= now()) as ready_count,
    count(*) filter (
      where s.status = 'processing'
        and s.last_dequeued_at is not null
        and s.finished_at is null
    ) as inflight_count
  from public.content_job_stages s
  group by s.stage
  order by s.stage;
end;
$$;

comment on function public.get_content_stage_backlog is 'Summarises ready/in-flight depth per stage to guide dispatcher scaling';

grant execute on function public.get_content_stage_backlog() to anon, authenticated, service_role;

-- RPC wrapper for pg_net.http_post that accepts JSON payload and headers
create or replace function public.trigger_content_worker(
  p_worker_endpoint text,
  p_stage text,
  p_queue text,
  p_payload jsonb default '{}'::jsonb,
  p_headers jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, net, pg_temp
as $$
declare
  v_headers jsonb := coalesce(
    p_headers,
    jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.edge_function_service_role_key', true)
    )
  );
  v_response jsonb;
begin
  select net.http_post(
    p_worker_endpoint,
    p_payload,
    v_headers
  ) into v_response;

  insert into content_job_events (job_id, stage, status, message, metadata)
  values (
    null,
    p_stage,
    'dispatched',
    format('Dispatcher invoked %s for queue %s', p_worker_endpoint, p_queue),
    jsonb_build_object('endpoint', p_worker_endpoint)
  );

  return coalesce(v_response, jsonb_build_object('status', 'ok'));
end;
$$;

grant execute on function public.trigger_content_worker(text, text, text, jsonb, jsonb) to service_role;

-- Schedule dispatcher cron job (runs every minute; close enough granularity)
do $$
begin
  if exists (select 1 from cron.job where jobname = 'planperfect-content-queue-dispatcher') then
    perform cron.unschedule('planperfect-content-queue-dispatcher');
  end if;
end $$;

select cron.schedule(
  'planperfect-content-queue-dispatcher',
  '*/1 * * * *',
  $$
    select net.http_post(
      'https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/content-queue-dispatcher',
      jsonb_build_object('source', 'cron'),
      jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.edge_function_service_role_key', true)
      )
    );
  $$
);
