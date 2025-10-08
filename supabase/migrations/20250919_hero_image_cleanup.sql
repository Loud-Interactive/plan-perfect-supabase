-- Clean up legacy hero-image triggers/functions that conflict with the pg_net workflow

-- Drop legacy trigger functions (cascade removes dependent triggers)
drop function if exists public.trigger_hero_image_prompt_generation() cascade;
drop function if exists public.trigger_hero_image_generation() cascade;
drop function if exists public.trigger_enhance_hero_prompt() cascade;
drop function if exists public.fn_auto_set_hero_ready() cascade;
drop function if exists public.fn_generate_hero_prompt() cascade;

-- Ensure the pg_net-driven trigger functions are present (from latest implementation)
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
  new_status := fn_normalize_status(new.status);
  if tg_op = 'UPDATE' then
    old_status := fn_normalize_status(old.status);
  end if;

  if new_status not in ('COMPLETED', 'COMPLETE') then
    return new;
  end if;
  if tg_op = 'UPDATE' and old_status in ('COMPLETED', 'COMPLETE') then
    return new;
  end if;
  if new.content_plan_outline_guid is null or new.content is null then
    return new;
  end if;
  if new.hero_image_prompt is not null then
    return new;
  end if;

  service_key := btrim(coalesce(
    nullif(current_setting('app.settings.edge_function_service_role_key', true), ''),
    (select value::text
     from public.app_secrets
     where key = 'supabase_service_role_key'
     order by created_at desc
     limit 1)
  ));
  if service_key is null then
    raise warning 'edge_function_service_role_key not configured; skipping hero prompt call for task %', new.task_id;
    return new;
  end if;

  functions_base_url := coalesce(
    nullif(current_setting('app.settings.functions_base_url', true), ''),
    (select value
     from public.app_secrets
     where key = 'supabase_url'
     order by created_at desc
     limit 1),
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
  if new.hero_image_prompt is null or new.hero_image_url is not null then
    return new;
  end if;

  service_key := btrim(coalesce(
    nullif(current_setting('app.settings.edge_function_service_role_key', true), ''),
    (select value::text
     from public.app_secrets
     where key = 'supabase_service_role_key'
     order by created_at desc
     limit 1)
  ));
  if service_key is null then
    raise warning 'edge_function_service_role_key not configured; skipping hero image call for task %', new.task_id;
    return new;
  end if;

  functions_base_url := coalesce(
    nullif(current_setting('app.settings.functions_base_url', true), ''),
    (select value
     from public.app_secrets
     where key = 'supabase_url'
     order by created_at desc
     limit 1),
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

-- Recreate triggers to ensure they point at the refreshed functions
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
