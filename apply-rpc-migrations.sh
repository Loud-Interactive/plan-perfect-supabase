#!/bin/bash
# Apply all RPC helper function migrations in order

echo "📦 Applying RPC helper function migrations..."
echo ""

migrations=(
  "supabase/migrations/20251014_create_save_outline_rpc.sql"
  "supabase/migrations/20251014_create_update_task_by_id_rpc.sql"
  "supabase/migrations/20251014_create_update_task_hero_image_rpc.sql"
  "supabase/migrations/20251014_create_update_task_live_post_url_rpc.sql"
  "supabase/migrations/20251014_create_content_plan_helper_rpcs.sql"
  "supabase/migrations/20251014_create_task_query_rpcs.sql"
)

for migration in "${migrations[@]}"; do
  filename=$(basename "$migration")
  echo "➡️  Applying: $filename"

  if supabase db execute --file "$migration"; then
    echo "   ✅ Success"
  else
    echo "   ❌ Failed"
    exit 1
  fi

  echo ""
done

echo "🎉 All RPC migrations applied successfully!"
echo ""
echo "Available RPC functions:"
echo "  - save_outline"
echo "  - update_task_by_id"
echo "  - update_task_hero_image (with triggers disabled)"
echo "  - update_task_live_post_url (with triggers disabled)"
echo "  - get_content_plan_by_guid"
echo "  - get_content_plans_by_domain"
echo "  - update_content_plan_by_guid"
echo "  - get_task_by_id"
echo "  - get_tasks_by_outline_guid"
echo "  - get_tasks_by_content_plan_guid"
echo "  - update_task_status_by_id (with triggers disabled)"
echo "  - delete_task_by_id"
