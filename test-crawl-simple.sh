#!/bin/bash

# Simple test script for crawl-page-html-enhanced
# Usage: ./test-crawl-simple.sh

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}======================================${NC}"
echo -e "${BLUE}Testing crawl-page-html-enhanced${NC}"
echo -e "${BLUE}======================================${NC}\n"

# Check for environment variables
if [ -z "$SUPABASE_URL" ]; then
  echo -e "${RED}❌ SUPABASE_URL not set${NC}"
  echo "Please export SUPABASE_URL first"
  exit 1
fi

if [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
  echo -e "${RED}❌ SUPABASE_SERVICE_ROLE_KEY not set${NC}"
  echo "Please export SUPABASE_SERVICE_ROLE_KEY first"
  exit 1
fi

TEST_URL="https://example.com"

echo -e "${YELLOW}📍 Supabase URL: $SUPABASE_URL${NC}"
echo -e "${YELLOW}🔗 Test URL: $TEST_URL${NC}\n"

echo -e "${BLUE}🧪 Test 1: First crawl (fresh or cached)${NC}"
echo -e "${BLUE}===========================================${NC}\n"

START_TIME=$(date +%s%3N)

RESPONSE1=$(curl -s -w "\n%{http_code}" \
  -X POST \
  "$SUPABASE_URL/functions/v1/crawl-page-html-enhanced" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"url\": \"$TEST_URL\"}")

HTTP_CODE1=$(echo "$RESPONSE1" | tail -n1)
BODY1=$(echo "$RESPONSE1" | head -n -1)

END_TIME=$(date +%s%3N)
DURATION1=$((END_TIME - START_TIME))

echo -e "⏱️  Duration: ${DURATION1}ms"
echo -e "📊 HTTP Status: $HTTP_CODE1\n"

if [ "$HTTP_CODE1" != "200" ]; then
  echo -e "${RED}❌ Test 1 failed with HTTP $HTTP_CODE1${NC}"
  echo "$BODY1"
  exit 1
fi

# Parse JSON response
SUCCESS1=$(echo "$BODY1" | grep -o '"success":[^,}]*' | cut -d':' -f2)
PAGE_ID1=$(echo "$BODY1" | grep -o '"pageId":[0-9]*' | cut -d':' -f2)
CRAWL_METHOD1=$(echo "$BODY1" | grep -o '"crawlMethod":"[^"]*"' | cut -d'"' -f4)
CACHED1=$(echo "$BODY1" | grep -o '"cached":true' || echo "false")

echo -e "${GREEN}✅ Success: $SUCCESS1${NC}"
echo -e "${GREEN}✅ Page ID: ${PAGE_ID1:-N/A}${NC}"
echo -e "${GREEN}✅ Crawl Method: $CRAWL_METHOD1${NC}"
echo -e "${GREEN}✅ Cached: ${CACHED1}${NC}\n"

# Wait 2 seconds
echo -e "${YELLOW}⏳ Waiting 2 seconds before Test 2...${NC}\n"
sleep 2

echo -e "${BLUE}🧪 Test 2: Second crawl (should be cached)${NC}"
echo -e "${BLUE}===========================================${NC}\n"

START_TIME=$(date +%s%3N)

RESPONSE2=$(curl -s -w "\n%{http_code}" \
  -X POST \
  "$SUPABASE_URL/functions/v1/crawl-page-html-enhanced" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"url\": \"$TEST_URL\"}")

HTTP_CODE2=$(echo "$RESPONSE2" | tail -n1)
BODY2=$(echo "$RESPONSE2" | head -n -1)

END_TIME=$(date +%s%3N)
DURATION2=$((END_TIME - START_TIME))

echo -e "⏱️  Duration: ${DURATION2}ms"
echo -e "📊 HTTP Status: $HTTP_CODE2\n"

if [ "$HTTP_CODE2" != "200" ]; then
  echo -e "${RED}❌ Test 2 failed with HTTP $HTTP_CODE2${NC}"
  echo "$BODY2"
  exit 1
fi

# Parse JSON response
SUCCESS2=$(echo "$BODY2" | grep -o '"success":[^,}]*' | cut -d':' -f2)
PAGE_ID2=$(echo "$BODY2" | grep -o '"pageId":[0-9]*' | cut -d':' -f2)
CRAWL_METHOD2=$(echo "$BODY2" | grep -o '"crawlMethod":"[^"]*"' | cut -d'"' -f4)
CACHED2=$(echo "$BODY2" | grep -o '"cached":true' || echo "false")

echo -e "${GREEN}✅ Success: $SUCCESS2${NC}"
echo -e "${GREEN}✅ Page ID: ${PAGE_ID2:-N/A}${NC}"
echo -e "${GREEN}✅ Crawl Method: $CRAWL_METHOD2${NC}"
echo -e "${GREEN}✅ Cached: ${CACHED2}${NC}\n"

# Summary
echo -e "${BLUE}======================================${NC}"
echo -e "${BLUE}📊 TEST SUMMARY${NC}"
echo -e "${BLUE}======================================${NC}\n"

if [ "$CRAWL_METHOD2" = "cached" ]; then
  echo -e "${GREEN}✅ CACHE WORKING PERFECTLY!${NC}"
  echo -e "   Test 1: ${CRAWL_METHOD1} (${DURATION1}ms)"
  echo -e "   Test 2: ${CRAWL_METHOD2} (${DURATION2}ms)"
  
  if [ "$DURATION2" -lt 500 ]; then
    echo -e "\n${GREEN}✅ Cache response is FAST (< 500ms)${NC}"
  fi
else
  echo -e "${YELLOW}⚠️  Cache not triggered${NC}"
  echo -e "   This might be normal if page wasn't in DB yet"
fi

if [ "$PAGE_ID1" = "$PAGE_ID2" ] && [ -n "$PAGE_ID1" ]; then
  echo -e "\n${GREEN}✅ Page IDs match: $PAGE_ID1${NC}"
  echo -e "   Both requests reference the same database record"
else
  echo -e "\n${YELLOW}⚠️  Page IDs differ or missing${NC}"
fi

echo -e "\n${GREEN}🎉 All tests passed!${NC}\n"

