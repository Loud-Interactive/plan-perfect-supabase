#!/bin/bash

# Comprehensive diagnostics for tasks table update issues
# This script checks triggers, RLS policies, constraints, and foreign keys

echo "========================================="
echo "TASKS TABLE UPDATE DIAGNOSTICS"
echo "========================================="

# Check if we have database connection
if [ -z "$SUPABASE_DB_PASSWORD" ]; then
    echo "ERROR: SUPABASE_DB_PASSWORD not set"
    echo "Please set it with: export SUPABASE_DB_PASSWORD='your-password'"
    exit 1
fi

DB_URL="postgresql://postgres.jsypctdhynsdqrfifvdh:${SUPABASE_DB_PASSWORD}@aws-0-us-east-1.pooler.supabase.com:6543/postgres"

echo ""
echo "1. Checking all triggers..."
echo "----------------------------"
psql "$DB_URL" -f check-all-triggers.sql

echo ""
echo ""
echo "2. Checking RLS policies..."
echo "----------------------------"
psql "$DB_URL" -f check-tasks-rls.sql

echo ""
echo ""
echo "3. Checking constraints..."
echo "----------------------------"
psql "$DB_URL" -f check-tasks-constraints.sql

echo ""
echo ""
echo "4. Checking if specific task exists..."
echo "----------------------------"
psql "$DB_URL" -f check-specific-task.sql

echo ""
echo ""
echo "5. Testing a direct UPDATE with RPC..."
echo "----------------------------"
psql "$DB_URL" <<EOF
-- Try to update a test task with our RPC
SELECT update_task_hero_image(
  'de7ef8be-b715-49cc-8a50-5e65463263ae'::text,
  'https://test.com/image.jpg'::text,
  'Testing'::text,
  '{"test": true}'::text
) AS result;

-- Check PostgreSQL logs/notices
\echo 'Checking for NOTICE/WARNING messages above...'
EOF

echo ""
echo "========================================="
echo "DIAGNOSTICS COMPLETE"
echo "========================================="
