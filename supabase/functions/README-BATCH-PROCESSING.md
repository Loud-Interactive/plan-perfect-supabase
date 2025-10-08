# Batch Processing for 1175+ Content Plans

This guide explains how to process a large number of content plans efficiently, with proper error handling and the ability to resume if interrupted.

## Overview of the Approach

1. Deploy the necessary edge functions to Supabase
2. Extract the GUIDs of all content plans that need processing
3. Process content plans in batches using a shell script

## Step 1: Deploy Edge Functions

First, deploy the required edge functions:

```bash
# Navigate to your project
cd /Users/martinbowling/Projects/planperfect-supabase

# Deploy the functions
supabase functions deploy process-content-plan --project-ref jsypctdhynsdqrfifvdh
supabase functions deploy export-content-plan-guids --project-ref jsypctdhynsdqrfifvdh
```

## Step 2: Set Up Required Files

1. Make the shell script executable:

```bash
chmod +x supabase/functions/process-content-plans.sh
```

2. Make sure you have `jq` installed (required for processing JSON):

```bash
# macOS
brew install jq

# Ubuntu/Debian
sudo apt-get install jq

# Windows (with chocolatey)
choco install jq
```

## Step 3: Run the Batch Processing Script

```bash
# Navigate to a directory where you want to store the log files
cd /Users/martinbowling/Projects/planperfect-supabase

# Run the script
./supabase/functions/process-content-plans.sh
```

## How It Works

1. **Export GUIDs**: The script first exports all content plan GUIDs that have content_plan_table data.
2. **Batch Processing**: It processes plans in batches of 25 (configurable in the script).
3. **Progress Tracking**: Progress is saved after each plan is processed, allowing you to resume if interrupted.
4. **Error Handling**: Any errors are logged to a separate file for review.
5. **Rate Limiting**: The script includes delays between requests and batches to avoid rate limits.

## Files Created by the Script

- `content_plan_guids.json`: List of all GUIDs to process
- `content_plan_progress.txt`: Current progress (index of last processed plan)
- `content_plan_processing.log`: Detailed log of all operations
- `content_plan_errors.txt`: Record of any errors encountered

## Customizing the Script

You can edit the script to adjust:

- `BATCH_SIZE`: Number of content plans to process in each batch
- `DELAY_BETWEEN_REQUESTS`: Seconds to wait between processing individual plans
- `DELAY_BETWEEN_BATCHES`: Seconds to wait between batches

## Resuming After Interruption

If the script stops for any reason, simply run it again. It will automatically resume from where it left off.

## Checking Status

While the script is running, you can check:

```bash
# See how many content plans have been processed
cat content_plan_progress.txt

# View the most recent log entries
tail -n 50 content_plan_processing.log

# Check if there were any errors
cat content_plan_errors.txt
``` 