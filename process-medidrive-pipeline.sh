#!/bin/bash
# Process the complete Medidrive content pipeline
# Triggers each worker stage sequentially

JOB_ID="c1680e74-08f5-47ea-accc-797aef57f6c7"
SUPABASE_URL="${SUPABASE_URL:-https://jsypctdhynsdqrfifvdh.supabase.co}"

# Load service role key from .env
set -a
source .env 2>/dev/null
set +a

echo "🔄 Processing Medidrive Content Pipeline"
echo "Job ID: $JOB_ID"
echo "========================================"
echo ""

# Stage 2: Outline
echo "2️⃣ Triggering outline worker..."
curl -s -X POST "$SUPABASE_URL/functions/v1/content-outline-worker" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{}" | jq -r '.message // .'
sleep 3

# Stage 3: Draft
echo ""
echo "3️⃣ Triggering draft worker..."
curl -s -X POST "$SUPABASE_URL/functions/v1/content-draft-worker" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{}" | jq -r '.message // .'
sleep 3

# Stage 4: QA
echo ""
echo "4️⃣ Triggering QA worker..."
curl -s -X POST "$SUPABASE_URL/functions/v1/content-qa-worker" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{}" | jq -r '.message // .'
sleep 3

# Stage 5: Export
echo ""
echo "5️⃣ Triggering export worker..."
curl -s -X POST "$SUPABASE_URL/functions/v1/content-export-worker" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{}" | jq -r '.message // .'
sleep 3

# Stage 6: Complete
echo ""
echo "6️⃣ Triggering complete worker..."
curl -s -X POST "$SUPABASE_URL/functions/v1/content-complete-worker" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{}" | jq -r '.message // .'

echo ""
echo "========================================"
echo "✅ All workers triggered!"
echo ""
echo "Check final status:"
echo "  python monitor-content-job.py $JOB_ID"

