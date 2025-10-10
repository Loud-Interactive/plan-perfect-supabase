#!/bin/bash

# Fast Mode Outline Generation Test Script
# Tests both fast and slow modes and compares results

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

SUPABASE_URL="https://jsypctdhynsdqrfifvdh.supabase.co"
SUPABASE_KEY="${SUPABASE_ANON_KEY:-}"

if [ -z "$SUPABASE_KEY" ]; then
  echo -e "${RED}Error: SUPABASE_ANON_KEY environment variable not set${NC}"
  echo "Set it with: export SUPABASE_ANON_KEY=your_key"
  exit 1
fi

echo -e "${BLUE}🚀 Fast Mode Outline Generation Test${NC}"
echo ""

# Test parameters
DOMAIN="centr.com"
POST_TITLE="Best Protein Shakes for Muscle Building"
CONTENT_PLAN_KEYWORD="protein shakes"
POST_KEYWORD="best protein shakes muscle building"

echo -e "${YELLOW}Test Parameters:${NC}"
echo "  Domain: $DOMAIN"
echo "  Title: $POST_TITLE"
echo "  Keyword: $POST_KEYWORD"
echo ""

# Function to create outline
create_outline() {
  local fast_mode=$1
  local mode_name=$2

  echo -e "${BLUE}Creating outline with $mode_name...${NC}"

  local response=$(curl -s -X POST "$SUPABASE_URL/functions/v1/generate-outline" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $SUPABASE_KEY" \
    -d "{
      \"post_title\": \"$POST_TITLE\",
      \"content_plan_keyword\": \"$CONTENT_PLAN_KEYWORD\",
      \"post_keyword\": \"$POST_KEYWORD\",
      \"domain\": \"$DOMAIN\",
      \"fast\": $fast_mode
    }")

  echo "$response"
}

# Test fast mode
echo -e "${GREEN}Testing Fast Mode...${NC}"
FAST_RESPONSE=$(create_outline "true" "Fast Mode")
FAST_JOB_ID=$(echo "$FAST_RESPONSE" | jq -r '.job_id')

if [ "$FAST_JOB_ID" == "null" ]; then
  echo -e "${RED}Failed to create fast mode job${NC}"
  echo "$FAST_RESPONSE" | jq '.'
  exit 1
fi

echo -e "${GREEN}✓ Fast mode job created: $FAST_JOB_ID${NC}"
echo ""

# Test slow mode
echo -e "${GREEN}Testing Slow Mode...${NC}"
SLOW_RESPONSE=$(create_outline "false" "Slow Mode")
SLOW_JOB_ID=$(echo "$SLOW_RESPONSE" | jq -r '.job_id')

if [ "$SLOW_JOB_ID" == "null" ]; then
  echo -e "${RED}Failed to create slow mode job${NC}"
  echo "$SLOW_RESPONSE" | jq '.'
  exit 1
fi

echo -e "${GREEN}✓ Slow mode job created: $SLOW_JOB_ID${NC}"
echo ""

# Monitor progress
echo -e "${BLUE}Monitoring job progress...${NC}"
echo "Fast Mode: https://app.supabase.com/project/jsypctdhynsdqrfifvdh/editor/outline_generation_jobs?filter=id%3Aeq%3A$FAST_JOB_ID"
echo "Slow Mode: https://app.supabase.com/project/jsypctdhynsdqrfifvdh/editor/outline_generation_jobs?filter=id%3Aeq%3A$SLOW_JOB_ID"
echo ""

echo -e "${YELLOW}📊 To check status:${NC}"
echo ""
echo "Fast Mode:"
echo "  SELECT status, updated_at FROM outline_generation_jobs WHERE id = '$FAST_JOB_ID';"
echo ""
echo "Slow Mode:"
echo "  SELECT status, updated_at FROM outline_generation_jobs WHERE id = '$SLOW_JOB_ID';"
echo ""

echo -e "${YELLOW}📝 To view detailed statuses:${NC}"
echo ""
echo "Fast Mode:"
echo "  SELECT status, created_at FROM content_plan_outline_statuses WHERE outline_guid = '$FAST_JOB_ID' ORDER BY created_at;"
echo ""
echo "Slow Mode:"
echo "  SELECT status, created_at FROM content_plan_outline_statuses WHERE outline_guid = '$SLOW_JOB_ID' ORDER BY created_at;"
echo ""

echo -e "${YELLOW}🔍 To compare results:${NC}"
echo ""
echo "Fast Mode Results:"
echo "  SELECT COUNT(*), search_category FROM outline_search_results WHERE job_id = '$FAST_JOB_ID' GROUP BY search_category;"
echo ""
echo "Slow Mode Results:"
echo "  SELECT COUNT(*), search_category FROM outline_search_results WHERE job_id = '$SLOW_JOB_ID' GROUP BY search_category;"
echo ""

echo -e "${GREEN}✅ Test jobs created successfully!${NC}"
echo ""
echo "Both jobs are now processing. Fast mode should complete in 2-5 minutes."
echo "Slow mode will take 10-20 minutes."
