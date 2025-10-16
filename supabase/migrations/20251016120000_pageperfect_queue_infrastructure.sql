-- PagePerfect Queue-Based Infrastructure Migration
-- Mirrors content_jobs architecture for PagePerfect workflow

-- ========================================
-- 1. Create pageperfect queue
-- ========================================
DO $$
BEGIN
  PERFORM pgmq.create('pageperfect');
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;

-- ========================================
-- 2. Create pageperfect_jobs table
-- ========================================
create table if not exists public.pageperfect_jobs (
  id uuid primary key default gen_random_uuid(),
  page_id uuid references public.pages(id) on delete cascade,
  url text not null,
  job_type text not null default 'workflow',
  requester_email text,
  status text not null default 'queued',
  stage text not null default 'submit_crawl',
  priority integer not null default 0,
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  error jsonb,
  max_attempts integer not null default 5,
  attempt_count integer not null default 0,
  retry_delay_seconds integer not null default 60,
  first_queued_at timestamptz,
  last_queued_at timestamptz,
  last_dequeued_at timestamptz,
  last_completed_at timestamptz,
  last_failed_at timestamptz,
  last_dead_letter_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.pageperfect_jobs is 'PagePerfect workflow jobs with queue-based orchestration';
comment on column public.pageperfect_jobs.page_id is 'Reference to the page being analyzed';
comment on column public.pageperfect_jobs.url is 'URL being processed';
comment on column public.pageperfect_jobs.job_type is 'Type of PagePerfect job (workflow, recrawl, etc)';
comment on column public.pageperfect_jobs.stage is 'Current stage of the workflow';
comment on column public.pageperfect_jobs.max_attempts is 'Maximum retry attempts across job lifecycle';
comment on column public.pageperfect_jobs.attempt_count is 'Total number of attempts performed';
comment on column public.pageperfect_jobs.retry_delay_seconds is 'Base retry delay in seconds';

create index if not exists pageperfect_jobs_status_idx on public.pageperfect_jobs (status, stage);
create index if not exists pageperfect_jobs_created_idx on public.pageperfect_jobs (created_at desc);
create index if not exists pageperfect_jobs_page_id_idx on public.pageperfect_jobs (page_id);
create index if not exists pageperfect_jobs_status_priority_idx 
  on public.pageperfect_jobs (status, priority desc, created_at asc);

-- ========================================
-- 3. Create pageperfect_job_stages table
-- ========================================
create table if not exists public.pageperfect_job_stages (
  job_id uuid references public.pageperfect_jobs(id) on delete cascade,
  stage text not null,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  retry_delay_seconds integer not null default 60,
  priority integer not null default 0,
  visibility_timeout_seconds integer not null default 600,
  available_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  last_queued_at timestamptz,
  last_dequeued_at timestamptz,
  next_retry_at timestamptz,
  last_error jsonb,
  dead_lettered_at timestamptz,
  dead_letter_reason text,
  primary key (job_id, stage)
);

comment on table public.pageperfect_job_stages is 'Stage-level tracking for PagePerfect jobs';
comment on column public.pageperfect_job_stages.stage is 'Stage name: submit_crawl, wait_crawl, segment_embed, keyword_clustering, gap_analysis, rewrite_draft';
comment on column public.pageperfect_job_stages.status is 'Stage status: pending, queued, processing, completed, error, failed';
comment on column public.pageperfect_job_stages.attempt_count is 'Number of attempts for this stage';
comment on column public.pageperfect_job_stages.available_at is 'Next time the stage becomes available for dequeue';

create index if not exists pageperfect_job_stages_status_available_idx
  on public.pageperfect_job_stages (status, available_at, priority desc);

create index if not exists pageperfect_job_stages_next_retry_idx
  on public.pageperfect_job_stages (next_retry_at)
  where next_retry_at is not null;

-- ========================================
-- 4. Create pageperfect_dead_letters table
-- ========================================
create table if not exists public.pageperfect_dead_letters (
  id bigserial primary key,
  queue_name text not null default 'pageperfect',
  msg_id bigint,
  job_id uuid,
  stage text,
  payload jsonb not null,
  failure_reason text,
  error_details jsonb,
  attempt_count integer not null default 0,
  routed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.pageperfect_dead_letters is 'Dead letter queue for failed PagePerfect jobs';
comment on column public.pageperfect_dead_letters.queue_name is 'Source queue name (pageperfect)';
comment on column public.pageperfect_dead_letters.msg_id is 'Original pgmq message identifier';
comment on column public.pageperfect_dead_letters.job_id is 'Associated PagePerfect job identifier';
comment on column public.pageperfect_dead_letters.stage is 'Stage name where failure occurred';

create index if not exists pageperfect_dead_letters_queue_idx
  on public.pageperfect_dead_letters (queue_name, stage);

create index if not exists pageperfect_dead_letters_job_idx
  on public.pageperfect_dead_letters (job_id);

create index if not exists pageperfect_dead_letters_routed_idx
  on public.pageperfect_dead_letters (routed_at desc);

-- ========================================
-- 5. Create pageperfect_job_events table for audit trail
-- ========================================
create table if not exists public.pageperfect_job_events (
  id bigserial primary key,
  job_id uuid references public.pageperfect_jobs(id) on delete cascade,
  stage text,
  status text,
  message text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

comment on table public.pageperfect_job_events is 'Event log for PagePerfect job lifecycle';

create index if not exists pageperfect_job_events_job_id_idx on public.pageperfect_job_events (job_id, created_at desc);
create index if not exists pageperfect_job_events_created_idx on public.pageperfect_job_events (created_at desc);

-- ========================================
-- 6. Create pageperfect_payloads table for stage data
-- ========================================
create table if not exists public.pageperfect_payloads (
  job_id uuid references public.pageperfect_jobs(id) on delete cascade,
  stage text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (job_id, stage)
);

comment on table public.pageperfect_payloads is 'Stage-specific payload data for PagePerfect jobs';

-- ========================================
-- 7. Create update trigger for updated_at columns
-- ========================================
create trigger trg_pageperfect_jobs_updated
before update on public.pageperfect_jobs
for each row execute procedure public.set_updated_at();

create trigger trg_pageperfect_payloads_updated
before update on public.pageperfect_payloads
for each row execute procedure public.set_updated_at();

-- ========================================
-- 8. Create PagePerfect-specific RPCs
-- ========================================

-- Create PagePerfect job with initial stage enqueue
create or replace function public.create_pageperfect_job(
  p_url text,
  p_page_id uuid,
  p_payload jsonb default '{}'::jsonb,
  p_initial_stage text default 'submit_crawl',
  p_priority integer default 0,
  p_max_attempts integer default 5,
  p_retry_delay_seconds integer default 60,
  p_requester_email text default null
)
returns uuid
language plpgsql
as $$
declare
  v_job_id uuid;
  v_stage text := coalesce(p_initial_stage, 'submit_crawl');
begin
  insert into public.pageperfect_jobs (
    url,
    page_id,
    job_type,
    requester_email,
    payload,
    status,
    stage,
    priority,
    max_attempts,
    retry_delay_seconds,
    first_queued_at,
    last_queued_at
  ) values (
    p_url,
    p_page_id,
    'workflow',
    p_requester_email,
    coalesce(p_payload, '{}'::jsonb),
    'queued',
    v_stage,
    coalesce(p_priority, 0),
    greatest(p_max_attempts, 1),
    greatest(p_retry_delay_seconds, 1),
    now(),
    now()
  ) returning id into v_job_id;

  perform public.pageperfect_enqueue_stage(
    'pageperfect',
    v_job_id,
    v_stage,
    coalesce(p_payload, '{}'::jsonb),
    coalesce(p_priority, 0),
    0,
    600,
    p_max_attempts,
    p_retry_delay_seconds
  );

  return v_job_id;
end;
$;

comment on function public.create_pageperfect_job is 'Creates a PagePerfect job and enqueues the initial stage';

-- Get PagePerfect stage backlog
create or replace function public.get_pageperfect_stage_backlog()
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
  from public.pageperfect_job_stages s
  group by s.stage
  order by s.stage;
end;
$$;

comment on function public.get_pageperfect_stage_backlog is 'Returns ready/inflight counts per PagePerfect stage for dispatcher';

-- Insert PagePerfect event helper
create or replace function public.insert_pageperfect_event(
  p_job_id uuid,
  p_status text,
  p_message text,
  p_metadata jsonb default null,
  p_stage text default null
)
returns void
language sql
as $$
  insert into public.pageperfect_job_events (job_id, stage, status, message, metadata)
  values (p_job_id, p_stage, p_status, p_message, p_metadata);
$$;

comment on function public.insert_pageperfect_event is 'Inserts an event into pageperfect_job_events';

-- PagePerfect-specific queue RPCs (reusing generic enqueue_stage, dequeue_stage, etc from content pipeline)
create or replace function public.pageperfect_enqueue_stage(
  p_queue text,
  p_job_id uuid,
  p_stage text,
  p_payload jsonb default '{}'::jsonb,
  p_priority integer default 0,
  p_delay_seconds integer default 0,
  p_visibility_seconds integer default 600,
  p_max_attempts integer default null,
  p_retry_delay_seconds integer default null
)
returns bigint
language plpgsql
as $
declare
  v_now timestamptz := now();
  v_delay integer := greatest(p_delay_seconds, 0);
  v_visibility integer := greatest(p_visibility_seconds, 1);
  v_priority integer := coalesce(p_priority, 0);
  v_available_at timestamptz := v_now + make_interval(secs => v_delay);
  v_stage record;
  v_msg_id bigint;
  v_max_attempts integer;
  v_retry_delay integer;
begin
  select * into v_stage
  from public.pageperfect_job_stages
  where job_id = p_job_id
    and stage = p_stage;

  v_max_attempts := coalesce(p_max_attempts, v_stage.max_attempts, 5);
  v_retry_delay := coalesce(p_retry_delay_seconds, v_stage.retry_delay_seconds, 60);

  insert into public.pageperfect_job_stages (
    job_id,
    stage,
    status,
    attempt_count,
    max_attempts,
    retry_delay_seconds,
    priority,
    available_at,
    last_queued_at,
    visibility_timeout_seconds
  ) values (
    p_job_id,
    p_stage,
    'queued',
    coalesce(v_stage.attempt_count, 0),
    v_max_attempts,
    v_retry_delay,
    v_priority,
    v_available_at,
    v_now,
    v_visibility
  )
  on conflict (job_id, stage) do update
  set status = 'queued',
      max_attempts = excluded.max_attempts,
      retry_delay_seconds = excluded.retry_delay_seconds,
      priority = excluded.priority,
      available_at = excluded.available_at,
      last_queued_at = excluded.last_queued_at,
      visibility_timeout_seconds = excluded.visibility_timeout_seconds,
      next_retry_at = excluded.available_at
  returning * into v_stage;

  update public.pageperfect_jobs
  set stage = p_stage,
      status = 'queued',
      priority = greatest(priority, v_priority),
      max_attempts = coalesce(p_max_attempts, max_attempts),
      retry_delay_seconds = coalesce(p_retry_delay_seconds, retry_delay_seconds),
      first_queued_at = coalesce(first_queued_at, v_now),
      last_queued_at = v_now,
      last_dequeued_at = case when last_dequeued_at is null then null else last_dequeued_at end
  where id = p_job_id;

  if v_delay > 0 then
    select pgmq.send(
      p_queue,
      jsonb_build_object(
        'job_id', p_job_id,
        'stage', p_stage,
        'payload', coalesce(p_payload, '{}'::jsonb),
        'priority', v_priority,
        'available_at', v_available_at,
        'enqueued_at', v_now
      ),
      v_delay
    ) into v_msg_id;
  else
    select pgmq.send(
      p_queue,
      jsonb_build_object(
        'job_id', p_job_id,
        'stage', p_stage,
        'payload', coalesce(p_payload, '{}'::jsonb),
        'priority', v_priority,
        'available_at', v_available_at,
        'enqueued_at', v_now
      )
    ) into v_msg_id;
  end if;

  return v_msg_id;
end;
$;

create or replace function public.pageperfect_dequeue_stage(
  p_queue text,
  p_visibility_seconds integer default 600
)
returns table(msg_id bigint, message jsonb)
language plpgsql
as $
declare
  v_record record;
  v_job_id uuid;
  v_stage text;
  v_now timestamptz := now();
begin
  select * into v_record from pgmq.pop(p_queue, greatest(p_visibility_seconds, 1));

  if not found or v_record.msg_id is null then
    return;
  end if;

  v_job_id := (v_record.message->>'job_id')::uuid;
  v_stage := v_record.message->>'stage';

  update public.pageperfect_job_stages
  set last_dequeued_at = v_now,
      visibility_timeout_seconds = greatest(p_visibility_seconds, 1)
  where job_id = v_job_id
    and stage = v_stage;

  update public.pageperfect_jobs
  set last_dequeued_at = v_now
  where id = v_job_id;

  return query select v_record.msg_id, v_record.message;
end;
$;

create or replace function public.pageperfect_dequeue_stage_batch(
  p_queue text,
  p_visibility_seconds integer default 600,
  p_batch_size integer default 10
)
returns table(msg_id bigint, message jsonb)
language plpgsql
as $
declare
  v_counter integer := 0;
  v_record record;
  v_job_id uuid;
  v_stage text;
  v_now timestamptz := now();
begin
  while v_counter < greatest(p_batch_size, 1) loop
    select * into v_record from pgmq.pop(p_queue, greatest(p_visibility_seconds, 1));
    exit when not found or v_record.msg_id is null;

    v_job_id := (v_record.message->>'job_id')::uuid;
    v_stage := v_record.message->>'stage';

    update public.pageperfect_job_stages
    set last_dequeued_at = v_now,
        visibility_timeout_seconds = greatest(p_visibility_seconds, 1)
    where job_id = v_job_id
      and stage = v_stage;

    update public.pageperfect_jobs
    set last_dequeued_at = v_now
    where id = v_job_id;

    v_counter := v_counter + 1;
    msg_id := v_record.msg_id;
    message := v_record.message;
    return next;
  end loop;
end;
$;

create or replace function public.pageperfect_extend_message_visibility(
  p_queue text,
  p_msg_id bigint,
  p_job_id uuid,
  p_stage text,
  p_additional_seconds integer default 300
)
returns boolean
language plpgsql
as $
declare
  v_success boolean := false;
begin
  begin
    select pgmq.set_vt(p_queue, p_msg_id, greatest(p_additional_seconds, 1)) into v_success;
  exception when undefined_function then
    v_success := false;
  end;

  update public.pageperfect_job_stages
  set visibility_timeout_seconds = visibility_timeout_seconds + greatest(p_additional_seconds, 1)
  where job_id = p_job_id
    and stage = p_stage;

  return coalesce(v_success, false);
end;
$;

create or replace function public.pageperfect_move_to_dead_letter(
  p_queue text,
  p_msg_id bigint,
  p_job_id uuid,
  p_stage text,
  p_message jsonb,
  p_failure_reason text,
  p_error_details jsonb default null,
  p_attempt_count integer default 0
)
returns bigint
language plpgsql
as $
declare
  v_dlq_id bigint;
  v_now timestamptz := now();
begin
  insert into public.pageperfect_dead_letters (
    queue_name,
    msg_id,
    job_id,
    stage,
    payload,
    failure_reason,
    error_details,
    attempt_count,
    routed_at
  ) values (
    p_queue,
    p_msg_id,
    p_job_id,
    p_stage,
    coalesce(p_message, '{}'::jsonb),
    p_failure_reason,
    p_error_details,
    coalesce(p_attempt_count, 0),
    v_now
  )
  returning id into v_dlq_id;

  perform pgmq.archive(p_queue, p_msg_id);

  update public.pageperfect_job_stages
  set dead_lettered_at = v_now,
      dead_letter_reason = p_failure_reason,
      status = 'failed'
  where job_id = p_job_id
    and stage = p_stage;

  update public.pageperfect_jobs
  set status = 'failed',
      last_failed_at = v_now,
      last_dead_letter_at = v_now
  where id = p_job_id;

  return v_dlq_id;
end;
$;

create or replace function public.pageperfect_delayed_requeue_stage(
  p_queue text,
  p_msg_id bigint,
  p_job_id uuid,
  p_stage text,
  p_payload jsonb default '{}'::jsonb,
  p_base_delay_seconds integer default 60,
  p_priority integer default null,
  p_visibility_seconds integer default 600
)
returns bigint
language plpgsql
as $
declare
  v_stage record;
  v_delay integer;
  v_priority integer;
  v_new_msg_id bigint;
  v_attempt integer;
  v_now timestamptz := now();
begin
  select * into v_stage
  from public.pageperfect_job_stages
  where job_id = p_job_id and stage = p_stage;

  v_attempt := coalesce(v_stage.attempt_count, 0);
  v_priority := coalesce(p_priority, v_stage.priority, 0);
  v_delay := greatest(p_base_delay_seconds, v_stage.retry_delay_seconds, 1) * greatest(v_attempt, 1);
  v_delay := least(v_delay, 3600);

  perform pgmq.archive(p_queue, p_msg_id);

  select public.pageperfect_enqueue_stage(
    p_queue,
    p_job_id,
    p_stage,
    p_payload,
    v_priority,
    v_delay,
    p_visibility_seconds,
    v_stage.max_attempts,
    v_stage.retry_delay_seconds
  ) into v_new_msg_id;

  update public.pageperfect_job_stages
  set next_retry_at = v_now + make_interval(secs => v_delay)
  where job_id = p_job_id and stage = p_stage;

  return v_new_msg_id;
end;
$;

-- ========================================
-- 9. Create monitoring view
-- ========================================
create or replace view public.v_pageperfect_job_status as
select 
  j.id as job_id,
  j.page_id,
  j.url,
  j.job_type,
  j.status,
  j.stage,
  j.priority,
  j.attempt_count,
  j.max_attempts,
  j.created_at,
  j.updated_at,
  j.last_completed_at,
  j.last_failed_at,
  max(e.created_at) as last_event_at,
  max(case when e.status = 'error' then e.message end) filter (where e.status = 'error') as last_error_message
from public.pageperfect_jobs j
left join public.pageperfect_job_events e on e.job_id = j.id
group by j.id, j.page_id, j.url, j.job_type, j.status, j.stage, j.priority, 
         j.attempt_count, j.max_attempts, j.created_at, j.updated_at, 
         j.last_completed_at, j.last_failed_at;

comment on view public.v_pageperfect_job_status is 'Monitoring view for PagePerfect job status';

-- ========================================
-- 10. Permission grants
-- ========================================
grant execute on function public.create_pageperfect_job(text, uuid, jsonb, text, integer, integer, integer, text) to service_role;
grant execute on function public.get_pageperfect_stage_backlog() to anon, authenticated, service_role;
grant execute on function public.insert_pageperfect_event(uuid, text, text, jsonb, text) to service_role;
grant execute on function public.pageperfect_enqueue_stage(text, uuid, text, jsonb, integer, integer, integer, integer, integer) to anon, authenticated, service_role;
grant execute on function public.pageperfect_dequeue_stage(text, integer) to anon, authenticated, service_role;
grant execute on function public.pageperfect_dequeue_stage_batch(text, integer, integer) to anon, authenticated, service_role;
grant execute on function public.pageperfect_extend_message_visibility(text, bigint, uuid, text, integer) to anon, authenticated, service_role;
grant execute on function public.pageperfect_move_to_dead_letter(text, bigint, uuid, text, jsonb, text, jsonb, integer) to anon, authenticated, service_role;
grant execute on function public.pageperfect_delayed_requeue_stage(text, bigint, uuid, text, jsonb, integer, integer, integer) to anon, authenticated, service_role;

grant select, insert, update on table public.pageperfect_jobs to anon, authenticated, service_role;
grant select, insert, update on table public.pageperfect_job_stages to anon, authenticated, service_role;
grant select, insert on table public.pageperfect_dead_letters to anon, authenticated, service_role;
grant select, insert on table public.pageperfect_job_events to anon, authenticated, service_role;
grant select, insert, update on table public.pageperfect_payloads to anon, authenticated, service_role;
grant select on table public.v_pageperfect_job_status to anon, authenticated, service_role;
