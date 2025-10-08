# Process Classification Batch Edge Function

This Supabase Edge Function processes a single batch of keywords from a classification job. It retrieves the next batch of unprocessed keywords, calls the `classify-keyword` function to process them, and updates the job progress.

## Features

- Automatic batch retrieval using database functions
- Uses the classify-keyword function for consistent processing
- Error handling with retry mechanisms
- Job progress tracking
- Support for manual job resumption after failure

## Usage

### Request Format

```json
{
  "jobId": "123e4567-e89b-12d3-a456-426614174000",
  "manual": false
}
```

Parameters:
- `jobId`: UUID of the classification job to process
- `manual`: (Optional) Set to true to force processing of a failed job

### Response Format

```json
{
  "message": "Batch processed successfully",
  "jobId": "123e4567-e89b-12d3-a456-426614174000",
  "batchNumber": 3,
  "processedCount": 50,
  "missingCount": 0,
  "complete": true
}
```

## Processing Steps

1. Validates the job exists and is in a valid state for processing
2. Uses the `get_next_classification_batch` database function to get the next batch
3. Updates the job status to "processing"
4. Calls the classify-keyword function with the batch of keywords
5. Stores the results in the classification_results table
6. Updates the job progress using database functions
7. Returns information about the processed batch

## Deployment

Deploy this function using the Supabase CLI:

```bash
supabase functions deploy process-classification-batch
```

## Related Functions

- `submit-classification-job`: Creates a new classification job
- `classify-keyword`: Performs the actual keyword classification
- `get-classification-results`: Retrieves results from a classification job
- `check-classification-status`: Checks the status of a classification job

## Database Integration

This function works with the database schema defined in `migrations/20250521_classification_jobs_tables.sql`, particularly using:

- The `get_next_classification_batch` function to retrieve batches
- The `update_classification_job_progress` function to update progress
- The `mark_classification_job_failed` function to mark jobs as failed