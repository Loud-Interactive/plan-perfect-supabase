-- Ensure required extensions are available
create extension if not exists pg_net with schema extensions;

-- Helper function to normalize hero image status strings
create or replace function public.fn_normalize_status(p_status text)
returns text
language sql
immutable
as $$
  select upper(replace(replace(coalesce(p_status, ''), ' ', '_'), '-', '_'))
$$;

-- Trigger function: call edge function to generate hero prompt when task reaches Completed
create or replace function public.fn_request_hero_prompt()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_status text;
  old_status text := null;
  service_key text;
  functions_base_url text;
  target_url text;
  request_body text;
begin
  -- Normalize statuses to handle "Complete" vs "Completed"
  new_status := fn_normalize_status(new.status);

  if tg_op = 'UPDATE' then
    old_status := fn_normalize_status(old.status);
  end if;

  -- Only proceed when entering the completed state
  if new_status not in ('COMPLETED', 'COMPLETE') then
    return new;
  end if;

  if tg_op = 'UPDATE' and old_status in ('COMPLETED', 'COMPLETE') then
    return new;
  end if;

  -- Require a GUID and HTML content to work with
  if new.content_plan_outline_guid is null or new.content is null then
    return new;
  end if;

  -- Skip if a prompt already exists
  if new.hero_image_prompt is not null then
    return new;
  end if;

  -- Pull service role key from app settings (set via ALTER DATABASE or ALTER ROLE)
  service_key := btrim(coalesce(
    nullif(current_setting('app.settings.edge_function_service_role_key', true), ''),
    (
      select value::text
      from public.app_secrets
      where key = 'supabase_service_role_key'
      order by created_at desc
      limit 1
    )
  ));

  if service_key is null then
    raise warning 'edge_function_service_role_key not configured; skipping hero prompt call for task %', new.task_id;
    return new;
  end if;

  -- Resolve functions base URL, fallback to project default
  functions_base_url := coalesce(
    nullif(current_setting('app.settings.functions_base_url', true), ''),
    (
      select value
      from public.app_secrets
      where key = 'supabase_url'
      order by created_at desc
      limit 1
    ),
    'https://jsypctdhynsdqrfifvdh.supabase.co'
  );

  if position('/functions/' in functions_base_url) = 0 then
    functions_base_url := rtrim(functions_base_url, '/') || '/functions/v1';
  end if;

  target_url := functions_base_url || '/generate-hero-image-prompt';
  request_body := jsonb_build_object('content_plan_outline_guid', new.content_plan_outline_guid)::text;

  begin
    perform net.http_post(
      url := target_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || service_key,
        'apikey', service_key
      ),
      body := request_body,
      timeout_milliseconds := 10000
    );
  exception
    when others then
      raise warning 'Hero prompt request failed for task %: %', new.task_id, sqlerrm;
  end;

  return new;
end;
$$;

-- Trigger function: call edge function to generate hero image once prompt is ready
create or replace function public.fn_request_hero_image()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_status text;
  old_status text := null;
  service_key text;
  functions_base_url text;
  target_url text;
  request_body text;
begin
  if new.content_plan_outline_guid is null then
    return new;
  end if;

  new_status := fn_normalize_status(new.hero_image_status);

  if tg_op = 'UPDATE' then
    old_status := fn_normalize_status(old.hero_image_status);
  end if;

  if new_status <> 'PROMPT_READY' then
    return new;
  end if;

  if tg_op = 'UPDATE' and old_status = new_status then
    return new;
  end if;

  if new.hero_image_prompt is null then
    return new;
  end if;

  if new.hero_image_url is not null then
    -- Already have an image, no need to regenerate automatically
    return new;
  end if;

  service_key := btrim(coalesce(
    nullif(current_setting('app.settings.edge_function_service_role_key', true), ''),
    (
      select value::text
      from public.app_secrets
      where key = 'supabase_service_role_key'
      order by created_at desc
      limit 1
    )
  ));

  if service_key is null then
    raise warning 'edge_function_service_role_key not configured; skipping hero image call for task %', new.task_id;
    return new;
  end if;

  functions_base_url := coalesce(
    nullif(current_setting('app.settings.functions_base_url', true), ''),
    (
      select value
      from public.app_secrets
      where key = 'supabase_url'
      order by created_at desc
      limit 1
    ),
    'https://jsypctdhynsdqrfifvdh.supabase.co'
  );

  if position('/functions/' in functions_base_url) = 0 then
    functions_base_url := rtrim(functions_base_url, '/') || '/functions/v1';
  end if;

  target_url := functions_base_url || '/generate-hero-image';
  request_body := jsonb_build_object('guid', new.content_plan_outline_guid)::text;

  begin
    perform net.http_post(
      url := target_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || service_key,
        'apikey', service_key
      ),
      body := request_body,
      timeout_milliseconds := 10000
    );
  exception
    when others then
      raise warning 'Hero image request failed for task %: %', new.task_id, sqlerrm;
  end;

  return new;
end;
$$;

-- Wire triggers to tasks table
drop trigger if exists trg_request_hero_prompt on public.tasks;
create trigger trg_request_hero_prompt
after insert or update on public.tasks
for each row
execute function public.fn_request_hero_prompt();

drop trigger if exists trg_request_hero_image on public.tasks;
create trigger trg_request_hero_image
after insert or update on public.tasks
for each row
when (new.hero_image_status is not null)
execute function public.fn_request_hero_image();

-- Expose pg_net logs and hero function invocation history to REST
create or replace view public.pg_net_http_request_log as
select
  id,
  created_at,
  method,
  url,
  status_code,
  error,
  response_body
from extensions.pg_net_http_request_log;

create or replace view public.hero_function_invocations as
select
  id,
  created_at,
  name,
  path,
  method,
  status_code,
  error
from supabase_functions.invocations
where name in ('generate-hero-image-prompt', 'generate-hero-image');
