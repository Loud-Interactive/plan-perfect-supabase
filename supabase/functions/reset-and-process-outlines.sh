#!/bin/bash

# Configuration
SUPABASE_URL="https://jsypctdhynsdqrfifvdh.supabase.co"
SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpzeXBjdGRoeW5zZHFyZmlmdmRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDA2OTIwMzIsImV4cCI6MjA1NjI2ODAzMn0.2QxOFFLzmp6VByWImiw6zDz3rWy-5hsvEHw3EMemIKY"

# List of outline GUIDs to process
GUIDS=(
    "920b39f8-4594-4af0-b6c0-cb2de37541e4"
    "4f1612b6-8450-41e8-b471-2431ba0113ab"
    "1d98a180-ea62-4e2c-a337-46d5c3b7d577"
    "585d1dc9-b8fe-4582-8cdb-361ef348b1b0"
    "9c2c5aa0-0404-4432-9ee4-800fa8f9a107"
    "2bd70ba5-535c-4f2c-96d7-f0689d9e1219"
    "47171b3c-5fc4-4cba-bf7c-ec29acfa0a14"
    "3e7a9f4b-95f0-4638-9c68-b7de8e29442d"
    "eb948fb6-1d68-4c9f-b08f-afe3acb44079"
    "a9293990-f597-43e0-9c39-edc5851d6bcd"
)

# Process each GUID
for guid in "${GUIDS[@]}"; do
    echo "Processing outline GUID: $guid"
    
    # Reset the outline
    echo "Resetting outline..."
    curl -X POST "${SUPABASE_URL}/functions/v1/reset-stuck-outline" \
      -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
      -H "Content-Type: application/json" \
      -d "{\"content_plan_outline_guid\": \"$guid\"}"
    
    # Wait a moment before processing
    sleep 2
    
    # Process the outline
    echo "Processing outline..."
    curl -X POST "${SUPABASE_URL}/functions/v1/process-outline-job" \
      -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
      -H "Content-Type: application/json" \
      -d "{\"job_id\": \"$guid\"}"
    
    echo -e "\nCompleted processing for $guid"
    echo "----------------------------------------"
    
    # Wait between outlines to avoid overloading the system
    sleep 5
done

echo "All outlines have been reset and processed."