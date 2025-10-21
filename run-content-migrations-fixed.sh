#!/bin/bash
# Run content generation migrations in correct order
# FIXED for pgmq 1.4.4+

set -e  # Exit on error

echo "🚀 Running Content Generation Migrations (pgmq 1.4.4+ compatible)"
echo "================================================================"

cd /Users/martinbowling/Projects/pp-supabase

# Core content job infrastructure
echo ""
echo "1️⃣ Creating content_jobs tables and pgmq queues..."
supabase db push --include-all --file supabase/migrations/20250919_content_jobs.sql

echo ""
echo "2️⃣ Creating pgmq queues..."
supabase db push --include-all --file supabase/migrations/20250919_create_content_queue.sql

echo ""
echo "3️⃣ Creating content queue hardening..."
supabase db push --include-all --file supabase/migrations/20251016112651_content_queue_hardening.sql

echo ""
echo "4️⃣ Creating PagePerfect queue infrastructure..."
supabase db push --include-all --file supabase/migrations/20251016120000_pageperfect_queue_infrastructure.sql

# Task management RPCs
echo ""
echo "5️⃣ Creating update_task_by_id RPC..."
supabase db push --include-all --file supabase/migrations/20251014_create_update_task_by_id_rpc.sql

echo ""
echo "✅ All content migrations completed successfully!"
echo ""
echo "You can now use:"
echo "  - generate-side-by-side (content generation)"
echo "  - Content job queue system"
echo "  - PagePerfect queue system"

