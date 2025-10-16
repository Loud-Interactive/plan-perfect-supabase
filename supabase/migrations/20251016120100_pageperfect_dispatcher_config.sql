-- PagePerfect Dispatcher Configuration
-- Extends content_stage_config to include PagePerfect stages

-- Add PagePerfect stages to dispatcher configuration
insert into public.content_stage_config (stage, queue, worker_endpoint, max_concurrency, trigger_batch_size)
values
  ('submit_crawl', 'pageperfect', 'https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/pageperfect-submit-crawl-worker', 3, 1),
  ('wait_crawl', 'pageperfect', 'https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/pageperfect-wait-crawl-worker', 2, 1),
  ('segment_embed', 'pageperfect', 'https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/pageperfect-segment-embed-worker', 3, 1),
  ('keyword_clustering', 'pageperfect', 'https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/pageperfect-keyword-clustering-worker', 2, 1),
  ('gap_analysis', 'pageperfect', 'https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/pageperfect-gap-analysis-worker', 2, 1),
  ('rewrite_draft', 'pageperfect', 'https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/pageperfect-rewrite-draft-worker', 2, 1)
on conflict (stage) do update
set queue = excluded.queue,
    worker_endpoint = excluded.worker_endpoint,
    max_concurrency = excluded.max_concurrency,
    trigger_batch_size = excluded.trigger_batch_size,
    last_updated_at = now();

-- Update get_content_stage_backlog to also include PagePerfect stages
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
  -- Content stages
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
  
  union all
  
  -- PagePerfect stages
  select
    ps.stage::text,
    count(*) filter (where ps.status = 'queued' and ps.available_at <= now()) as ready_count,
    count(*) filter (
      where ps.status = 'processing'
        and ps.last_dequeued_at is not null
        and ps.finished_at is null
    ) as inflight_count
  from public.pageperfect_job_stages ps
  group by ps.stage
  
  order by stage;
end;
$$;

comment on function public.get_content_stage_backlog is 'Returns ready/inflight counts per stage for both content and PagePerfect pipelines';
