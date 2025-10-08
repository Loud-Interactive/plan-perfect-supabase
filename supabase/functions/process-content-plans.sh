#!/bin/bash

# Configuration
SUPABASE_PROJECT_REF="jsypctdhynsdqrfifvdh"
ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpzeXBjdGRoeW5zZHFyZmlmdmRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDA2OTIwMzIsImV4cCI6MjA1NjI2ODAzMn0.2QxOFFLzmp6VByWImiw6zDz3rWy-5hsvEHw3EMemIKY"
BATCH_SIZE=25
DELAY_BETWEEN_REQUESTS=1 # seconds between individual requests
DELAY_BETWEEN_BATCHES=5  # seconds between batches

# File to track progress
PROGRESS_FILE="content_plan_progress.txt"
GUIDS_FILE="content_plan_guids.json"
LOG_FILE="content_plan_processing.log"
ERROR_FILE="content_plan_errors.txt"

# Function to log messages
log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a "$LOG_FILE"
}

# Check if the GUIDs file exists
if [ ! -f "$GUIDS_FILE" ]; then
  log "GUIDs file not found. Downloading from Supabase..."
  
  # Export GUIDs from Supabase
  curl -X POST "https://$SUPABASE_PROJECT_REF.supabase.co/functions/v1/export-content-plan-guids" \
    -H "Authorization: Bearer $ANON_KEY" \
    -o "$GUIDS_FILE"
    
  if [ $? -ne 0 ]; then
    log "Error: Failed to export GUIDs from Supabase"
    exit 1
  fi
  
  log "Downloaded GUIDs file with $(jq length "$GUIDS_FILE") content plans"
fi

# Initialize progress file if it doesn't exist
if [ ! -f "$PROGRESS_FILE" ]; then
  echo "0" > "$PROGRESS_FILE"
  log "Initialized progress file"
fi

# Get total number of GUIDs
TOTAL_GUIDS=$(jq length "$GUIDS_FILE")
log "Total content plans to process: $TOTAL_GUIDS"

# Read current progress
CURRENT_INDEX=$(<"$PROGRESS_FILE")
log "Resuming from index $CURRENT_INDEX"

# Process GUIDs in batches
while [ "$CURRENT_INDEX" -lt "$TOTAL_GUIDS" ]; do
  BATCH_END=$((CURRENT_INDEX + BATCH_SIZE))
  if [ "$BATCH_END" -gt "$TOTAL_GUIDS" ]; then
    BATCH_END=$TOTAL_GUIDS
  fi
  
  log "Processing batch from index $CURRENT_INDEX to $((BATCH_END - 1))"
  
  # Process each GUID in the current batch
  for (( i=CURRENT_INDEX; i<BATCH_END; i++ )); do
    GUID=$(jq -r ".[$i]" "$GUIDS_FILE")
    log "Processing content plan $((i + 1))/$TOTAL_GUIDS (GUID: $GUID)"
    
    # Call the process-content-plan function
    RESPONSE=$(curl -s -X POST "https://$SUPABASE_PROJECT_REF.supabase.co/functions/v1/process-content-plan" \
      -H "Authorization: Bearer $ANON_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"content_plan_id\": \"$GUID\"}")
    
    SUCCESS=$(echo "$RESPONSE" | jq -r '.success')
    
    if [ "$SUCCESS" == "true" ]; then
      log "  Success: Content plan $GUID processed"
    else
      ERROR=$(echo "$RESPONSE" | jq -r '.error')
      log "  ERROR: Failed to process content plan $GUID: $ERROR"
      echo "$GUID: $ERROR" >> "$ERROR_FILE"
    fi
    
    # Update progress file after each successful processing
    echo "$((i + 1))" > "$PROGRESS_FILE"
    
    # Delay between requests
    sleep "$DELAY_BETWEEN_REQUESTS"
  done
  
  # Update progress after batch
  CURRENT_INDEX=$BATCH_END
  
  # If we have more to process, wait between batches
  if [ "$CURRENT_INDEX" -lt "$TOTAL_GUIDS" ]; then
    log "Completed batch. Waiting $DELAY_BETWEEN_BATCHES seconds before next batch..."
    sleep "$DELAY_BETWEEN_BATCHES"
  fi
done

log "All content plans have been processed!"
log "Check $ERROR_FILE for any errors that occurred during processing" 