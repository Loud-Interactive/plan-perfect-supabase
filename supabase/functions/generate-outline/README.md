# Generate Outline Function

This Supabase Edge Function initiates the AI-powered outline generation process.

## Purpose

This function:
1. Creates a new outline generation job
2. Records initial job details (title, keywords, domain)
3. Triggers the asynchronous outline generation process

## Deployment

```bash
supabase functions deploy generate-outline
```

## Environment Variables

Make sure these are set in your Supabase project:
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY

## Usage

### API Request

```bash
curl -X POST 'https://[YOUR-PROJECT-REF].supabase.co/functions/v1/generate-outline' \
  -H 'Authorization: Bearer [YOUR-ANON-KEY]' \
  -H 'Content-Type: application/json' \
  -d '{
    "content_plan_guid": "optional-content-plan-guid",
    "post_title": "How to Choose the Best Kitchen Knives",
    "content_plan_keyword": "kitchen knives",
    "post_keyword": "best kitchen knives", 
    "domain": "misen.com"
  }'
```

### Request Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| content_plan_guid | string | No | Optional ID of the content plan |
| post_title | string | Yes | Title of the post to generate an outline for |
| content_plan_keyword | string | Yes | Main keyword for the content plan |
| post_keyword | string | Yes | Specific keyword for this post |
| domain | string | Yes | Domain for brand/style context |

### Response

```json
{
  "success": true,
  "message": "Outline generation started",
  "job_id": "generated-job-id"
}
```

Use the returned `job_id` with the `get-outline-status` function to check progress.

## Related Functions

- `process-outline-job`: Does the actual outline generation work
- `get-outline-status`: Checks the status of an outline generation job
- `generate-outline-report`: Creates an HTML report for an outline job