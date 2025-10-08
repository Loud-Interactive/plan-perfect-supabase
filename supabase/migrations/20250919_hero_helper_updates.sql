-- Update helper function to delegate hero prompt generation to edge function
create or replace function public.generate_hero_prompt_for_task(p_task_id uuid)
returns text
language plpgsql
as $$
declare
  v_task tasks%rowtype;
  service_key text;
  base_url text;
  request_body jsonb;
begin
  select * into v_task
  from tasks
  where task_id = p_task_id;

  if not found then
    return null;
  end if;

  if v_task.content_plan_outline_guid is null then
    raise warning 'Task % has no content_plan_outline_guid; cannot request hero prompt', p_task_id;
    return null;
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
    raise warning 'Service key not configured; skipping hero prompt request for task %', p_task_id;
    return null;
  end if;

  base_url := coalesce(
    nullif(current_setting('app.settings.functions_base_url', true), ''),
    (select value
     from public.app_secrets
     where key = 'supabase_url'
     order by created_at desc
     limit 1),
    'https://jsypctdhynsdqrfifvdh.supabase.co'
  );

  if position('/functions/' in base_url) = 0 then
    base_url := rtrim(base_url, '/') || '/functions/v1';
  end if;

  request_body := jsonb_build_object('content_plan_outline_guid', v_task.content_plan_outline_guid);

  begin
    perform net.http_post(
      url := base_url || '/generate-hero-image-prompt',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || service_key,
        'apikey', service_key
      ),
      body := request_body,
      timeout_milliseconds := 10000
    );
  exception when others then
    raise warning 'Hero prompt helper request failed for task %: %', p_task_id, sqlerrm;
    return null;
  end;

  return 'Hero prompt generation requested via edge function';
end;
$$;

-- Drop unused legacy helper functions that bypass the edge workflow
drop function if exists public.fn_generate_hero_prompt();
drop function if exists public.fn_auto_set_hero_ready();
drop function if exists public.regenerate_hero_prompts_with_base();
