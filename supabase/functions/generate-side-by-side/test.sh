#!/bin/bash

# Test script for generate-side-by-side edge function
# Usage: ./test.sh [outline_guid] [task_id]

OUTLINE_GUID=$1
TASK_ID=$2

if [ -z "$OUTLINE_GUID" ]; then
  echo "Error: outline_guid is required"
  echo "Usage: ./test.sh [outline_guid] [task_id (optional)]"
  exit 1
fi

echo "🧪 Testing generate-side-by-side edge function"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Outline GUID: $OUTLINE_GUID"

if [ -n "$TASK_ID" ]; then
  echo "Task ID: $TASK_ID"
  BODY="{\"outline_guid\": \"$OUTLINE_GUID\", \"task_id\": \"$TASK_ID\"}"
else
  echo "Task ID: (new task will be created)"
  BODY="{\"outline_guid\": \"$OUTLINE_GUID\"}"
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Test locally
echo "Testing local function..."
echo ""
curl -X POST http://127.0.0.1:54321/functions/v1/generate-side-by-side \
  -H "Content-Type: application/json" \
  -d "$BODY" \
  | jq '.'

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Test complete!"
echo ""
echo "If testing deployed function, use:"
echo "curl -X POST https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/generate-side-by-side \\"
echo "  -H \"Content-Type: application/json\" \\"
echo "  -d '{\"outline_guid\": \"$OUTLINE_GUID\"}' | jq '.'"
