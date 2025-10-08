#!/bin/bash

# Preferences Perfect API Test Script
# Usage: ./pp-test.sh <supabase-url> <supabase-anon-key>

if [ "$#" -lt 2 ]; then
  echo "Usage: $0 <supabase-url> <supabase-anon-key>"
  echo "Example: $0 https://abc123.supabase.co eyJhbGciOiJIUzI1NiIsInR5cCI..."
  exit 1
fi

SUPABASE_URL=$1
SUPABASE_ANON_KEY=$2

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}========================================"
echo "Preferences Perfect API Test Script"
echo -e "========================================${NC}"

# Test domain for our operations
TEST_DOMAIN="test-domain-$(date +%s).com"
echo -e "Using test domain: ${GREEN}$TEST_DOMAIN${NC}"

# Function to run tests
run_test() {
  local test_name=$1
  local cmd=$2
  local expected_status=$3
  
  echo -e "\n${YELLOW}Testing: $test_name${NC}"
  echo "Command: $cmd"
  
  # Run the command and capture output and status
  RESPONSE=$(eval $cmd)
  STATUS=$?
  
  # Format the response for display
  FORMATTED_RESPONSE=$(echo $RESPONSE | jq . 2>/dev/null || echo $RESPONSE)
  
  echo "Response: $FORMATTED_RESPONSE"
  
  # Check if the status code matches what we expect
  if [ $STATUS -eq $expected_status ]; then
    echo -e "${GREEN}✓ Test passed${NC}"
    return 0
  else
    echo -e "${RED}✗ Test failed - Expected status $expected_status but got $STATUS${NC}"
    return 1
  fi
}

# 1. Public Endpoints (No Authentication)

# Test get-pairs (should return 404 for a new domain)
run_test "Get Pairs (Not Found)" "curl -s -X GET '$SUPABASE_URL/functions/v1/pp-get-pairs/$TEST_DOMAIN'" 0

# Run all tests (all endpoints are public now)
echo -e "\n${YELLOW}Running API tests...${NC}"

# Create new pairs
run_test "Create Pairs" "curl -s -X POST '$SUPABASE_URL/functions/v1/pp-create-pairs' \
  -H 'Content-Type: application/json' \
  -d '{\"domain\": \"$TEST_DOMAIN\", \"key_value_pairs\": {\"theme\": \"dark\", \"notifications\": true, \"count\": 42}}'" 0

# Get the GUID
GUID_RESPONSE=$(curl -s -X GET "$SUPABASE_URL/functions/v1/pp-get-guid/$TEST_DOMAIN")
GUID=$(echo $GUID_RESPONSE | jq -r '.guid' 2>/dev/null)

if [ -n "$GUID" ] && [ "$GUID" != "null" ]; then
  echo -e "Retrieved GUID: ${GREEN}$GUID${NC}"
  
  # Get all pairs for the domain
  run_test "Get All Pairs" "curl -s -X GET '$SUPABASE_URL/functions/v1/pp-get-all-pairs/$TEST_DOMAIN'" 0
    
  # Update a specific pair
  run_test "Update Pair" "curl -s -X PUT '$SUPABASE_URL/functions/v1/pp-update-pair/$TEST_DOMAIN/$GUID/theme' \
    -H 'Content-Type: application/json' \
    -d '{\"value\": \"light\"}'" 0
    
  # Update multiple pairs
  run_test "Update Multiple Pairs" "curl -s -X PUT '$SUPABASE_URL/functions/v1/pp-update-pairs/$TEST_DOMAIN/$GUID' \
    -H 'Content-Type: application/json' \
    -d '{\"notifications\": false, \"new_setting\": \"test\"}'" 0
    
  # Get specific keys
  run_test "Get Specific Keys" "curl -s -X POST '$SUPABASE_URL/functions/v1/pp-get-specific-pairs/$TEST_DOMAIN/keys' \
    -H 'Content-Type: application/json' \
    -d '{\"keys\": [\"theme\", \"notifications\"]}'" 0
    
  # Patch pairs
  run_test "Patch Pairs" "curl -s -X PATCH '$SUPABASE_URL/functions/v1/pp-patch-pairs/$TEST_DOMAIN' \
    -H 'Content-Type: application/json' \
    -d '{\"patched_key\": \"patched_value\"}'" 0
else
  echo -e "${RED}Failed to retrieve GUID, skipping remaining tests${NC}"
fi

echo -e "\n${YELLOW}Tests completed${NC}"