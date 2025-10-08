# Asynchronous Crawl Job System

This system provides a solution for handling long-running web scraping operations that exceed Supabase Edge Function's 60-second timeout limit. It's especially useful for scraping protected sites like orientaltrading.com that require advanced techniques.

## Overview

The asynchronous crawl job system includes:

1. **Job Queuing**: Submit jobs to a queue and get immediate responses
2. **Background Processing**: Jobs are processed by a cron job running in the background
3. **Batch Processing**: Submit thousands of URLs at once with a single API call
4. **Status Monitoring**: Check job status and retrieve results when ready
5. **Job Management**: View, retry, and manage all crawl jobs

## Key Components

### Database Tables

- `crawl_jobs`: Stores job details, status, HTML content, and metadata

### Edge Functions

- `submit-crawl-job`: Submit a single URL for processing
- `submit-crawl-jobs-batch`: Submit multiple URLs as a batch
- `process-crawl-jobs`: Process pending jobs in the queue
- `get-crawl-job`: Get status and results of a single job
- `get-crawl-jobs-batch`: Check status of a specific batch
- `wait-for-crawl-job`: Wait for a job to complete (with timeout)
- `list-crawl-job-batches`: List all batches with pagination
- `retry-failed-batch-jobs`: Reset failed jobs in a batch
- `crawl-cron`: Scheduled job that periodically processes pending jobs

## Usage

### Submitting a Single Job

```
POST /functions/v1/submit-crawl-job
```

Request body:
```json
{
  "url": "https://www.orientaltrading.com/web/browse/processProductsCatalog",
  "premium": false, 
  "ultraPremium": true,
  "render": true
}
```

Response:
```json
{
  "success": true,
  "jobId": "uuid-here",
  "status": "pending",
  "message": "Job submitted successfully"
}
```

### Submitting a Batch of Jobs

```
POST /functions/v1/submit-crawl-jobs-batch
```

Request body:
```json
{
  "urls": [
    "https://example.com/page1",
    "https://example.com/page2",
    "https://www.orientaltrading.com/product123"
  ],
  "premium": false,
  "ultraPremium": true,
  "render": true,
  "batchId": "optional-custom-batch-id"
}
```

Response:
```json
{
  "success": true,
  "batchId": "batch-12345",
  "total": 3,
  "successCount": 3,
  "failedCount": 0
}
```

### Checking Job Status

```
GET /functions/v1/get-crawl-job?jobId=uuid-here
```

Response:
```json
{
  "success": true,
  "job": {
    "id": "uuid-here",
    "url": "https://www.orientaltrading.com/web/browse/processProductsCatalog",
    "status": "completed",
    "created_at": "2023-04-05T12:00:00Z",
    "updated_at": "2023-04-05T12:01:30Z",
    "completed_at": "2023-04-05T12:01:30Z",
    "html_length": 145023,
    "processing_time_ms": 75342,
    "success_method": "Puppeteer Stealth"
  },
  "html": "<!DOCTYPE html>..."
}
```

### Waiting for Job Completion

```
POST /functions/v1/wait-for-crawl-job
```

Request body:
```json
{
  "jobId": "uuid-here",
  "maxWaitTimeMs": 300000,
  "pollingIntervalMs": 5000
}
```

Response:
```json
{
  "success": true,
  "job": {
    "id": "uuid-here",
    "url": "https://www.orientaltrading.com/web/browse/processProductsCatalog",
    "status": "completed",
    "created_at": "2023-04-05T12:00:00Z",
    "updated_at": "2023-04-05T12:01:30Z",
    "completed_at": "2023-04-05T12:01:30Z",
    "html_length": 145023,
    "processing_time_ms": 75342,
    "success_method": "Puppeteer Stealth"
  },
  "waitTime": 15123
}
```

### Checking Batch Status

```
GET /functions/v1/get-crawl-jobs-batch?batchId=batch-12345
```

Response:
```json
{
  "success": true,
  "counts": {
    "pending": 1,
    "processing": 1,
    "completed": 1,
    "error": 0,
    "total": 3
  },
  "progress": 33,
  "urls": [...]
}
```

### Listing All Batches

```
GET /functions/v1/list-crawl-job-batches?limit=25&offset=0
```

Response:
```json
{
  "batches": [
    {
      "batch_id": "batch-12345",
      "total": 3,
      "pending": 1,
      "processing": 1,
      "completed": 1,
      "error": 0,
      "progress": 33,
      "created_at": "2023-04-05T12:00:00Z",
      "last_updated": "2023-04-05T12:01:30Z"
    },
    {
      "batch_id": "batch-67890",
      "total": 10,
      "pending": 0,
      "processing": 0,
      "completed": 8,
      "error": 2,
      "progress": 100,
      "created_at": "2023-04-04T14:30:00Z",
      "last_updated": "2023-04-04T14:45:20Z"
    }
  ],
  "total": 2,
  "limit": 25,
  "offset": 0
}
```

### Retrying Failed Jobs

```
POST /functions/v1/retry-failed-batch-jobs
```

Request body:
```json
{
  "batchId": "batch-67890"
}
```

Response:
```json
{
  "success": true,
  "count": 2,
  "message": "Reset 2 failed jobs to pending status"
}
```

### Processing Jobs Manually

```
POST /functions/v1/process-crawl-jobs
```

Request body:
```json
{
  "batchSize": 5
}
```

Response:
```json
{
  "success": true,
  "processed": 3,
  "message": "Processed 3 jobs (2 completed, 1 failed)"
}
```

## Dashboard UI

The dashboard UI provides a user-friendly interface for:

1. Submitting single URLs
2. Submitting batches of URLs
3. Viewing batch status and progress
4. Monitoring individual job status
5. Managing failed jobs
6. Viewing detailed HTML results

## Error Handling

The system includes comprehensive error handling:

1. Individual job errors are captured and don't affect other jobs
2. Failed jobs can be retried with a single click
3. Retry counts are tracked to prevent infinite loops
4. Detailed error messages for debugging
5. Heartbeat tracking to prevent stuck jobs

## Integration with PagePerfect Workflow

The PagePerfect workflow has been updated to use the async job system:

1. It submits a crawl job and gets an immediate response
2. It then waits for the job to complete (with a configurable timeout)
3. Once the job is complete, it continues with the rest of the workflow
4. This prevents 504 Gateway Timeout errors from Supabase Edge Functions

## Deployment

Use the deployment script to set up the system:

```bash
./deploy-crawl-job-system.sh
```

The script:
1. Creates the crawl_jobs table and other required SQL objects
2. Deploys all edge functions
3. Sets up the cron job to run every minute
4. Updates the pageperfect-workflow function

## Cron Job Setup

The cron job is set up to run every minute and process pending jobs. It can be managed through the Supabase Dashboard:

1. Go to Edge Functions in the Supabase Dashboard
2. Select the crawl-cron function
3. Navigate to the Schedules tab
4. Verify that it's scheduled to run every minute (*/1 * * * *)