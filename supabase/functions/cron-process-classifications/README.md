# Cron Process Classifications Edge Function

This Supabase Edge Function serves as a cron job handler to automatically process batches of keyword classification jobs. It can process multiple jobs concurrently and multiple batches per job.

## Features

- Designed to be invoked by a scheduler at regular intervals
- Processes multiple jobs concurrently (default: 3)
- Processes multiple batches per job (default: 5)
- Supports manual invocation by administrators
- Graceful error handling to ensure cron jobs continue running

## Usage

### Scheduled Invocation

This function is primarily designed to be invoked by a scheduler like Supabase's built-in cron functionality:

```sql
-- Create a scheduled job to run every 5 minutes
INSERT INTO cron.job (schedule, command)
VALUES (
  '*/5 * * * *',
  $$
  SELECT http_post(
    url := '{{SUPABASE_URL}}/functions/v1/cron-process-classifications',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer {{SUPABASE_SERVICE_ROLE_KEY}}"}'
  );
  $$
);
```

### Manual Invocation

Administrators can also invoke this function manually:

```bash
curl -X POST https://your-project.supabase.co/functions/v1/cron-process-classifications \
  -H "Authorization: Bearer your-admin-token" \
  -d '{"maxJobs": 5, "maxBatches": 10}'
```

Parameters:
- `maxJobs` (optional): Override the default number of concurrent jobs to process
- `maxBatches` (optional): Override the default number of batches to process per job

### Response Format

```json
{
  "message": "Cron process completed",
  "jobsProcessed": 3,
  "timestamp": "2025-05-21T14:30:00.000Z",
  "details": [
    {
      "jobId": "123e4567-e89b-12d3-a456-426614174000",
      "batchesProcessed": 5,
      "results": [
        {
          "message": "Batch processed successfully",
          "jobId": "123e4567-e89b-12d3-a456-426614174000",
          "batchNumber": 1,
          "processedCount": 50,
          "missingCount": 0,
          "complete": true
        },
        // Additional batch results...
      ]
    },
    // Additional job results...
  ]
}
```

## Configuration

You can modify these constants in the code to adjust the processing volume:

```typescript
const MAX_CONCURRENT_JOBS = 3;  // Process up to 3 jobs at once
const MAX_BATCHES_PER_JOB = 5;  // Process up to 5 batches per job
```

## Deployment

Deploy this function using the Supabase CLI:

```bash
supabase functions deploy cron-process-classifications
```

## Performance Considerations

- **Rate Limits**: Be mindful of DeepSeek API rate limits when increasing concurrent processing
- **Function Timeout**: Supabase Edge Functions have a maximum execution time (default 60s)
- **Cost Management**: Adjust processing volume based on AI API usage costs

## Related Functions

- `process-classification-batch`: Called by this function to process individual batches
- `classify-keyword`: Core function for keyword classification
- `check-classification-status`: Check job progress and status