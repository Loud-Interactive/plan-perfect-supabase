#!/bin/bash

# Content Generation Migrations Runner
# Runs migrations in the correct order for content generation functions

set -e  # Exit on error

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Content Generation Migrations${NC}"
echo -e "${BLUE}========================================${NC}\n"

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
  echo -e "${YELLOW}⚠️  DATABASE_URL not set${NC}"
  echo "Please export DATABASE_URL first or run with:"
  echo "DATABASE_URL='your-connection-string' ./run-content-migrations.sh"
  echo ""
  echo "Or use Supabase CLI to link your project:"
  echo "supabase link --project-ref jsypctdhynsdqrfifvdh"
  exit 1
fi

echo -e "${GREEN}✅ DATABASE_URL configured${NC}\n"

# Function to run a migration
run_migration() {
  local file=$1
  local description=$2
  
  echo -e "${BLUE}📦 Running: $description${NC}"
  echo "   File: $file"
  
  if [ ! -f "$file" ]; then
    echo -e "${RED}❌ File not found: $file${NC}\n"
    return 1
  fi
  
  if supabase db push --file "$file" 2>&1 | tee /tmp/migration_output.txt; then
    # Check output for success or "already exists" messages
    if grep -q "already exists\|duplicate" /tmp/migration_output.txt; then
      echo -e "${YELLOW}   ℹ️  Already applied (skipped)${NC}\n"
    else
      echo -e "${GREEN}   ✅ Applied successfully${NC}\n"
    fi
    return 0
  else
    echo -e "${RED}   ❌ Failed${NC}\n"
    return 1
  fi
}

# Function to run SQL file directly
run_sql_file() {
  local file=$1
  local description=$2
  
  echo -e "${BLUE}📦 Running SQL: $description${NC}"
  echo "   File: $file"
  
  if [ ! -f "$file" ]; then
    echo -e "${RED}❌ File not found: $file${NC}\n"
    return 1
  fi
  
  if psql "$DATABASE_URL" -f "$file" 2>&1 | tee /tmp/sql_output.txt; then
    if grep -q "already exists\|duplicate" /tmp/sql_output.txt; then
      echo -e "${YELLOW}   ℹ️  Already exists (skipped)${NC}\n"
    else
      echo -e "${GREEN}   ✅ Executed successfully${NC}\n"
    fi
    return 0
  else
    echo -e "${RED}   ❌ Failed${NC}\n"
    return 1
  fi
}

echo -e "${YELLOW}========================================${NC}"
echo -e "${YELLOW}PHASE 1: Core Foundation (CRITICAL)${NC}"
echo -e "${YELLOW}========================================${NC}\n"

run_migration \
  "supabase/migrations/20250919_content_jobs.sql" \
  "Content Jobs Infrastructure"

run_migration \
  "supabase/migrations/20250919_create_content_queue.sql" \
  "Content Queue Setup (PGMQ)"

run_migration \
  "supabase/migrations/20251016112651_content_queue_hardening.sql" \
  "Content Queue Hardening"

run_migration \
  "supabase/migrations/20251016120000_add_content_job_metrics.sql" \
  "Content Job Metrics"

echo -e "${YELLOW}========================================${NC}"
echo -e "${YELLOW}PHASE 2: RPC Functions (Helper Functions)${NC}"
echo -e "${YELLOW}========================================${NC}\n"

run_migration \
  "supabase/migrations/20251014_create_update_task_by_id_rpc.sql" \
  "Update Task By ID RPC (CRITICAL)"

run_migration \
  "supabase/migrations/20251014_create_task_query_rpcs.sql" \
  "Task Query RPCs"

run_migration \
  "supabase/migrations/20251014_create_content_plan_helper_rpcs.sql" \
  "Content Plan Helper RPCs"

run_migration \
  "supabase/migrations/20251014_create_save_outline_rpc.sql" \
  "Save Outline RPC"

echo -e "${YELLOW}========================================${NC}"
echo -e "${YELLOW}PHASE 3: Optional Components${NC}"
echo -e "${YELLOW}========================================${NC}\n"

echo -e "${BLUE}Would you like to install optional components?${NC}"
echo "  1. Content Dispatcher (advanced job routing)"
echo "  2. Hero Image Support (image generation)"
echo "  3. Outline Generation (outline tables)"
echo "  4. Skip all optional"
echo ""
read -p "Enter your choice (1-4): " choice

case $choice in
  1)
    echo ""
    run_migration \
      "supabase/migrations/20251020120000_content_dispatcher.sql" \
      "Content Dispatcher"
    ;;
  2)
    echo ""
    run_migration \
      "supabase/migrations/20250919_hero_helper_updates.sql" \
      "Hero Helper Updates"
    
    run_migration \
      "supabase/migrations/20250919_hero_image_cleanup.sql" \
      "Hero Image Cleanup"
    
    run_migration \
      "supabase/migrations/20250919_hero_image_pg_net_triggers.sql" \
      "Hero Image Triggers"
    ;;
  3)
    echo ""
    run_sql_file \
      "supabase/functions/setup-outline-generation-tables.sql" \
      "Outline Generation Tables"
    ;;
  4)
    echo -e "${YELLOW}Skipping optional components${NC}\n"
    ;;
  *)
    echo -e "${YELLOW}Invalid choice, skipping optional components${NC}\n"
    ;;
esac

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}✅ Migration Complete!${NC}"
echo -e "${GREEN}========================================${NC}\n"

echo "Next steps:"
echo "  1. Verify setup: psql \$DATABASE_URL -c \"SELECT * FROM pgmq.list_queues();\""
echo "  2. Check tables: psql \$DATABASE_URL -c \"\\dt content*\""
echo "  3. Test functions: Deploy and test your edge functions"
echo ""
echo -e "${BLUE}📚 See CONTENT-GENERATION-MIGRATIONS-GUIDE.md for details${NC}\n"

