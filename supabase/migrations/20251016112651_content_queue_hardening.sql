-- Migration: Content Queue Hardening for High-Scale Throughput

-- ========================================
-- 1. Extend content_jobs table with retry + telemetry columns
-- ========================================
alter table public.content_jobs
  add column if not exists max_attempts integer not null default 5,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists retry_delay_seconds integer not null default 60,
  add column if not exists first_queued_at timestamptz,
  add column if not exists last_queued_at timestamptz,
  add column if not exists last_dequeued_at timestamptz,
  add column if not exists last_completed_at timestamptz,
  add column if not exists last_failed_at timestamptz,
  add column if not exists last_dead_letter_at timestamptz;

comment on column public.content_jobs.max_attempts is 'Allowed retry attempts across the whole job lifecycle';
comment on column public.content_jobs.attempt_count is 'Total number of attempts performed for this job';
comment on column public.content_jobs.retry_delay_seconds is 'Base retry delay in seconds for job level backoff';
comment on column public.content_jobs.first_queued_at is 'Timestamp when the job was first queued';
comment on column public.content_jobs.last_queued_at is 'Timestamp when the job was last queued';
comment on column public.content_jobs.last_dequeued_at is 'Timestamp when any stage was last dequeued';
comment on column public.content_jobs.last_completed_at is 'Timestamp when the job successfully completed';
comment on column public.content_jobs.last_failed_at is 'Timestamp when the job last failed';
comment on column public.content_jobs.last_dead_letter_at is 'Timestamp when the job was routed to dead letter queue';

create index if not exists content_jobs_status_priority_idx 
  on public.content_jobs (status, priority desc, created_at asc);

-- ========================================
-- 2. Extend content_job_stages table
-- ========================================
-- rename attempt column to attempt_count for clarity (if still named attempt)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'content_job_stages'
      AND column_name = 'attempt'
  )
  AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'content_job_stages'
      AND column_name = 'attempt_count'
  ) THEN
    ALTER TABLE public.content_job_stages RENAME COLUMN attempt TO attempt_count;
  END IF;
END $$;

alter table public.content_job_stages
  add column if not exists priority integer not null default 0,
  add column if not exists retry_delay_seconds integer not null default 60,
  add column if not exists visibility_timeout_seconds integer not null default 600,
  add column if not exists available_at timestamptz not null default now(),
  add column if not exists last_queued_at timestamptz,
  add column if not exists last_dequeued_at timestamptz,
  add column if not exists next_retry_at timestamptz,
  add column if not exists dead_lettered_at timestamptz,
  add column if not exists dead_letter_reason text;

comment on column public.content_job_stages.priority is 'Relative priority used when enqueueing';
comment on column public.content_job_stages.retry_delay_seconds is 'Base delay between retries for this stage';
comment on column public.content_job_stages.visibility_timeout_seconds is 'Visibility timeout applied when dequeued';
comment on column public.content_job_stages.available_at is 'Next time the stage becomes available for dequeue';
comment on column public.content_job_stages.last_queued_at is 'Last time the stage was enqueued';
comment on column public.content_job_stages.last_dequeued_at is 'Last time the stage was dequeued';
comment on column public.content_job_stages.next_retry_at is 'Scheduled time for the next retry attempt';
comment on column public.content_job_stages.dead_lettered_at is 'Time when the stage entered the dead letter queue';
comment on column public.content_job_stages.dead_letter_reason is 'Reason recorded when stage was dead lettered';

create index if not exists content_job_stages_status_available_idx
  on public.content_job_stages (status, available_at, priority desc);

create index if not exists content_job_stages_next_retry_idx
  on public.content_job_stages (next_retry_at)
  where next_retry_at is not null;

-- ========================================
-- 3. Create content_dead_letters table for persistent DLQ storage
-- ========================================
create table if not exists public.content_dead_letters (
  id bigserial primary key,
  queue_name text not null,
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

comment on table public.content_dead_letters is 'Persistent record of messages moved to the dead letter queue';
comment on column public.content_dead_letters.queue_name is 'Source queue name';
comment on column public.content_dead_letters.msg_id is 'Original pgmq message identifier';
comment on column public.content_dead_letters.job_id is 'Associated content job identifier';
comment on column public.content_dead_letters.stage is 'Stage name associated with the message';
comment on column public.content_dead_letters.payload is 'Original message payload as JSON';
comment on column public.content_dead_letters.failure_reason is 'Application level reason for dead-lettering';
comment on column public.content_dead_letters.error_details is 'Structured error details captured when dead-lettered';
comment on column public.content_dead_letters.attempt_count is 'Total attempts consumed prior to dead-lettering';

create index if not exists content_dead_letters_queue_idx
  on public.content_dead_letters (queue_name, stage);

create index if not exists content_dead_letters_job_idx
  on public.content_dead_letters (job_id);

create index if not exists content_dead_letters_routed_idx
  on public.content_dead_letters (routed_at desc);

-- ========================================
-- 4. Helper function to coalesce integers > 0
-- ========================================
create or replace function public.greatest_positive_int(values integer[])
returns integer
language plpgsql
as $$
declare
  v_result integer := 0;
  v_value integer;
begin
  foreach v_value in array values
  loop
    if v_value is not null and v_value > v_result then
      v_result := v_value;
    end if;
  end loop;
  return v_result;
end;
$$;

-- ========================================
-- 5. Enhanced enqueue_stage with priority + delay semantics
-- ========================================
create or replace function public.enqueue_stage(
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
as $$
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
  from public.content_job_stages
  where job_id = p_job_id
    and stage = p_stage;

  v_max_attempts := coalesce(p_max_attempts, v_stage.max_attempts, 5);
  v_retry_delay := coalesce(p_retry_delay_seconds, v_stage.retry_delay_seconds, 60);

  insert into public.content_job_stages (
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

  update public.content_jobs
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
$$;

-- ========================================
-- 6. Enhanced dequeue_stage (single)
-- ========================================
create or replace function public.dequeue_stage(
  p_queue text,
  p_visibility_seconds integer default 600
)
returns table(msg_id bigint, message jsonb)
language plpgsql
as $$
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

  update public.content_job_stages
  set last_dequeued_at = v_now,
      visibility_timeout_seconds = greatest(p_visibility_seconds, 1)
  where job_id = v_job_id
    and stage = v_stage;

  update public.content_jobs
  set last_dequeued_at = v_now
  where id = v_job_id;

  return query select v_record.msg_id, v_record.message;
end;
$$;

-- ========================================
-- 7. Batch dequeue RPC leveraging pgmq.pop in a loop
-- ========================================
create or replace function public.dequeue_stage_batch(
  p_queue text,
  p_visibility_seconds integer default 600,
  p_batch_size integer default 10
)
returns table(msg_id bigint, message jsonb)
language plpgsql
as $$
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

    update public.content_job_stages
    set last_dequeued_at = v_now,
        visibility_timeout_seconds = greatest(p_visibility_seconds, 1)
    where job_id = v_job_id
      and stage = v_stage;

    update public.content_jobs
    set last_dequeued_at = v_now
    where id = v_job_id;

    v_counter := v_counter + 1;
    msg_id := v_record.msg_id;
    message := v_record.message;
    return next;
  end loop;
end;
$$;

-- ========================================
-- 8. Extend message visibility leveraging pgmq.set_vt when available
-- ========================================
create or replace function public.extend_message_visibility(
  p_queue text,
  p_msg_id bigint,
  p_job_id uuid,
  p_stage text,
  p_additional_seconds integer default 300
)
returns boolean
language plpgsql
as $$
declare
  v_success boolean := false;
begin
  begin
    select pgmq.set_vt(p_queue, p_msg_id, greatest(p_additional_seconds, 1)) into v_success;
  exception when undefined_function then
    v_success := false;
  end;

  update public.content_job_stages
  set visibility_timeout_seconds = visibility_timeout_seconds + greatest(p_additional_seconds, 1)
  where job_id = p_job_id
    and stage = p_stage;

  return coalesce(v_success, false);
end;
$$;

-- ========================================
-- 9. Move message to dead letter queue
-- ========================================
create or replace function public.move_to_dead_letter(
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
as $$
declare
  v_dlq_id bigint;
  v_now timestamptz := now();
begin
  insert into public.content_dead_letters (
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

  update public.content_job_stages
  set dead_lettered_at = v_now,
      dead_letter_reason = p_failure_reason,
      status = 'failed'
  where job_id = p_job_id
    and stage = p_stage;

  update public.content_jobs
  set status = 'failed',
      last_failed_at = v_now,
      last_dead_letter_at = v_now
  where id = p_job_id;

  return v_dlq_id;
end;
$$;

-- ========================================
-- 10. Queue depth introspection via pgmq.metrics
-- ========================================
create or replace function public.get_queue_depth(
  p_queue text
)
returns jsonb
language plpgsql
as $$
declare
  v_metrics jsonb;
begin
  select to_jsonb(m) into v_metrics
  from pgmq.metrics(p_queue) as m;

  return coalesce(v_metrics, jsonb_build_object('queue_name', p_queue, 'ready', 0));
exception when others then
  return jsonb_build_object('queue_name', p_queue, 'error', SQLERRM);
end;
$$;

-- ========================================
-- 11. Delay requeue helper - archive current message and re-enqueue with backoff
-- ========================================
create or replace function public.delayed_requeue_stage(
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
as $$
declare
  v_stage record;
  v_delay integer;
  v_priority integer;
  v_new_msg_id bigint;
  v_attempt integer;
  v_now timestamptz := now();
begin
  select * into v_stage
  from public.content_job_stages
  where job_id = p_job_id and stage = p_stage;

  v_attempt := coalesce(v_stage.attempt_count, 0);
  v_priority := coalesce(p_priority, v_stage.priority, 0);
  v_delay := greatest(p_base_delay_seconds, v_stage.retry_delay_seconds, 1) * greatest(v_attempt, 1);
  v_delay := least(v_delay, 3600); -- cap delay at 1 hour to avoid runaway backoff

  perform pgmq.archive(p_queue, p_msg_id);

  select public.enqueue_stage(
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

  update public.content_job_stages
  set next_retry_at = v_now + make_interval(secs => v_delay)
  where job_id = p_job_id and stage = p_stage;

  return v_new_msg_id;
end;
$$;

-- ========================================
-- 12. Archive helper (retain existing behavior)
-- ========================================
create or replace function public.archive_message(
  p_queue text,
  p_msg_id bigint
)
returns void
language sql
as $$
  select pgmq.archive(p_queue, p_msg_id);
$$;

-- ========================================
-- 13. Batch archive helper for acking multiple messages
-- ========================================
create or replace function public.archive_messages(
  p_queue text,
  p_msg_ids bigint[]
)
returns void
language plpgsql
as $
declare
  v_msg_id bigint;
begin
  foreach v_msg_id in array p_msg_ids
  loop
    perform pgmq.archive(p_queue, v_msg_id);
  end loop;
end;
$;

-- ========================================
-- 14. Transactional job creation helper
-- ========================================
create or replace function public.create_content_job(
  p_job_type text,
  p_requester_email text,
  p_payload jsonb,
  p_initial_stage text,
  p_priority integer default 0,
  p_max_attempts integer default 5,
  p_retry_delay_seconds integer default 60,
  p_queue_override text default null
)
returns uuid
language plpgsql
as $
declare
  v_job_id uuid;
  v_stage text := coalesce(p_initial_stage, 'research');
  v_queue text := coalesce(p_queue_override, case when p_job_type = 'schema' then 'schema' else 'content' end);
begin
  insert into public.content_jobs (
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
    p_job_type,
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

  perform public.enqueue_stage(
    v_queue,
    v_job_id,
    v_stage,
    coalesce(p_payload, '{}'::jsonb),
    coalesce(p_priority, 0),
    0,
    null,
    p_max_attempts,
    p_retry_delay_seconds
  );

  return v_job_id;
end;
$;

-- ========================================
-- 15. Permission grants
-- ========================================
grant execute on function public.enqueue_stage(text, uuid, text, jsonb, integer, integer, integer, integer, integer) to anon, authenticated, service_role;
grant execute on function public.dequeue_stage(text, integer) to anon, authenticated, service_role;
grant execute on function public.dequeue_stage_batch(text, integer, integer) to anon, authenticated, service_role;
grant execute on function public.extend_message_visibility(text, bigint, uuid, text, integer) to anon, authenticated, service_role;
grant execute on function public.move_to_dead_letter(text, bigint, uuid, text, jsonb, text, jsonb, integer) to anon, authenticated, service_role;
grant execute on function public.get_queue_depth(text) to anon, authenticated, service_role;
grant execute on function public.delayed_requeue_stage(text, bigint, uuid, text, jsonb, integer, integer, integer) to anon, authenticated, service_role;
grant execute on function public.archive_message(text, bigint) to anon, authenticated, service_role;
grant execute on function public.archive_messages(text, bigint[]) to anon, authenticated, service_role;
grant execute on function public.create_content_job(text, text, jsonb, text, integer, integer, integer, text) to service_role;

grant select, insert on table public.content_dead_letters to anon, authenticated, service_role;
