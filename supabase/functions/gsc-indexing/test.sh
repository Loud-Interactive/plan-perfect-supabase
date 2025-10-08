#!/bin/bash

# Test GSC Indexing Function API Endpoints

BASE_URL="http://localhost:54321/functions/v1/gsc-indexing"

# Set test values
TEST_URL="https://example.com/page1"
TEST_SITE_URL="example.com"

# Function to call each endpoint
function test_endpoint() {
  endpoint=$1
  payload=$2
  
  echo "Testing endpoint: $endpoint"
  echo "Payload: $payload"
  
  result=$(curl -s -X POST "$BASE_URL/$endpoint" \
    -H "Content-Type: application/json" \
    -d "$payload")
    
  echo "Response:"
  echo "$result" | jq '.'
  echo "-------------------------"
}

# Test all endpoints
test_endpoint "request-indexing" "{\"url\": \"$TEST_URL\", \"siteUrl\": \"$TEST_SITE_URL\"}"
test_endpoint "get-sitemaps" "{\"siteUrl\": \"$TEST_SITE_URL\"}"
test_endpoint "check-indexation" "{\"url\": \"$TEST_URL\", \"siteUrl\": \"$TEST_SITE_URL\"}"