# Reset Stuck Outline Function

This Supabase Edge Function resets stuck outlines to allow them to be processed again.

## Purpose

This function:
1. Takes a job ID or content plan outline GUID
2. Resets the status of the outline generation job to 'pending'
3. Updates related tables to mark the outline as ready for reprocessing
4. Logs status changes to the content_plan_outline_statuses table

## Deployment

```bash
supabase functions deploy reset-stuck-outline
```

## Environment Variables

This function requires:
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY

## Usage

```bash
curl -X POST 'https://[YOUR-PROJECT-REF].supabase.co/functions/v1/reset-stuck-outline' \
  -H 'Authorization: Bearer [YOUR-SERVICE-KEY]' \
  -H 'Content-Type: application/json' \
  -d '{
    "job_id": "job-id-to-reset"
  }'
```

### Request Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| job_id | string | Yes* | ID of the job to reset |
| content_plan_outline_guid | string | Yes* | GUID of the outline to reset (alternative to job_id) |

\* Either job_id or content_plan_outline_guid is required

### Response

```json
{
  "success": true,
  "message": "Outline reset process started",
  "job_id": "job-id"
}
```

## Process Steps

1. **Validation**: Verify that the job exists
2. **Status Reset**: Update job status to 'pending'
3. **Status Tracking**: Add status updates to content_plan_outline_statuses
4. **Outline Reset**: Update content_plan_outlines status to 'pending'

## Related Functions

- `process-outline-job`: Processes the outline after reset
- `get-outline-status`: Checks the status of an outline generation job
- `regenerate-outline`: Creates a new version of an existing outline