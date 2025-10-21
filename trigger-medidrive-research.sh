#!/bin/bash
# Manually trigger the research worker for the Medidrive job

JOB_ID="c1680e74-08f5-47ea-accc-797aef57f6c7"
SUPABASE_URL="${SUPABASE_URL:-https://jsypctdhynsdqrfifvdh.supabase.co}"

# Load service role key from .env
set -a
source .env
set +a

echo "🚀 Manually triggering research worker for job: $JOB_ID"
echo ""

curl -X POST "$SUPABASE_URL/functions/v1/content-research-worker" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{}" \
  | jq '.'

echo ""
echo "✅ Worker triggered! Check status:"
echo "   python monitor-content-job.py $JOB_ID"

