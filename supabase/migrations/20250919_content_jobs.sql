-- content-v5 migration schema foundation

create extension if not exists pgmq;

create table if not exists public.content_jobs (
    id uuid primary key default gen_random_uuid(),
    job_type text not null,
    requester_email text,
    status text not null default 'queued',
    stage text not null default 'intake',
    priority integer not null default 0,
    payload jsonb not null default '{}'::jsonb,
    result jsonb,
    error jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists content_jobs_status_idx on public.content_jobs (status, stage);
create index if not exists content_jobs_created_idx on public.content_jobs (created_at desc);

create table if not exists public.content_payloads (
    job_id uuid references public.content_jobs(id) on delete cascade,
    stage text not null,
    data jsonb not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (job_id, stage)
);

create table if not exists public.content_job_events (
    id bigserial primary key,
    job_id uuid references public.content_jobs(id) on delete cascade,
    stage text,
    status text,
    message text,
    metadata jsonb,
    created_at timestamptz not null default now()
);

create table if not exists public.content_assets (
    id bigserial primary key,
    job_id uuid references public.content_jobs(id) on delete cascade,
    asset_type text not null,
    storage_path text,
    external_url text,
    created_at timestamptz not null default now()
);

create table if not exists public.content_job_stages (
    job_id uuid references public.content_jobs(id) on delete cascade,
    stage text not null,
    status text not null default 'pending',
    attempt integer not null default 0,
    max_attempts integer not null default 3,
    started_at timestamptz,
    finished_at timestamptz,
    last_error jsonb,
    primary key (job_id, stage)
);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

create trigger trg_content_jobs_updated
before update on public.content_jobs
for each row execute procedure public.set_updated_at();

create trigger trg_content_payloads_updated
before update on public.content_payloads
for each row execute procedure public.set_updated_at();

-- helper function to enqueue next stage
create or replace function public.enqueue_stage(p_queue text, p_job_id uuid, p_stage text, p_payload jsonb default '{}'::jsonb)
returns bigint
language sql
as $$
  select pgmq.send(p_queue, jsonb_build_object(
    'job_id', p_job_id,
    'stage', p_stage,
    'payload', p_payload,
    'enqueued_at', now()
  ));
$$;

create or replace function public.dequeue_stage(p_queue text, p_visibility integer default 600)
returns table(msg_id bigint, message jsonb)
language sql
as $$
  select * from pgmq.pop(p_queue, p_visibility);
$$;

create or replace function public.archive_message(p_queue text, p_msg_id bigint)
returns void
language sql
as $$
  select pgmq.archive(p_queue, p_msg_id);
$$;

-- convenience view for monitoring
create or replace view public.v_content_job_status as
select j.id as job_id,
       j.job_type,
       j.status,
       j.stage,
       j.created_at,
       j.updated_at,
       max(e.created_at) as last_event_at,
       max(case when e.status = 'error' then e.message end) filter (where e.status = 'error') as last_error_message
from public.content_jobs j
left join public.content_job_events e on e.job_id = j.id
group by j.id, j.job_type, j.status, j.stage, j.created_at, j.updated_at;

create or replace function public.init_content_job_stages()
returns trigger as $$
begin
  insert into public.content_job_stages (job_id, stage, status)
  values (new.id, new.stage, 'queued')
  on conflict (job_id, stage) do nothing;
  return new;
end;
$$ language plpgsql;

create trigger trg_content_jobs_init_stages
after insert on public.content_jobs
for each row execute procedure public.init_content_job_stages();

create or replace function public.notify_content_job_error()
returns trigger as $$
begin
  if new.status = 'error' then
    perform net.http_post(
      'https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/alert-dispatch',
      jsonb_build_object(
        'job_id', new.job_id,
        'stage', new.stage,
        'message', new.message,
        'metadata', new.metadata
      ),
      jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.edge_function_service_role_key', true)
      )
    );
  end if;
  return new;
end;
$$ language plpgsql;

create trigger trg_content_job_events_alert
after insert on public.content_job_events
for each row execute procedure public.notify_content_job_error();
