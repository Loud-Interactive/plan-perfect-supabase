# Hero Image Cron Job Function

This Supabase Edge Function is designed to be run as a scheduled job that automatically processes content plan outlines that need hero images.

## Functionality

1. Can be triggered manually or on a schedule via a cron job
2. Calls the batch-generate-hero-images function to process outlines
3. Provides authentication for both manual and scheduled invocations
4. Returns statistics about the processing job

## API Endpoint

**URL**: `/hero-image-cron`

**Methods**: `GET` or `POST`

**Authentication**:
- For scheduled jobs: Include CRON_SECRET in the Authorization header
- For manual invocation: Requires a logged-in user with appropriate permissions

**Parameters**:
- `limit`: Maximum number of outlines to process (default: 10)
- `cron`: Set to "true" when invoked by a scheduler

**Request Examples**:

Cron job invocation:
```
GET /hero-image-cron?cron=true&limit=20
Authorization: Bearer YOUR_CRON_SECRET
```

Manual POST invocation:
```json
POST /hero-image-cron
{
  "limit": 5
}
```

**Response**:
```json
{
  "success": true,
  "message": "Hero image generation job completed",
  "started_at": "2025-04-24T20:45:12.789Z",
  "results": {
    "success": true,
    "total": 5,
    "success_count": 4,
    "error_count": 1,
    "results": [...]
  }
}
```

## Deployment

Deploy this function with:

```bash
supabase functions deploy hero-image-cron --no-verify-jwt
```

## Environment Variables

This function requires the following environment variables:

- `CRON_SECRET`: A secret token for authenticating cron job requests
- `SUPABASE_URL`: Your Supabase project URL (automatically available in Edge Functions)
- `SUPABASE_SERVICE_ROLE_KEY`: Your Supabase service role key (automatically available in Edge Functions)

Set the CRON_SECRET with:

```bash
supabase secrets set CRON_SECRET=your-secure-cron-secret
```

## Setting Up the Cron Job

You can schedule this function to run automatically using services like:

1. GitHub Actions
2. Supabase's built-in scheduled functions (when available)
3. External schedulers like Pipedream or n8n

Example cURL command for a cron job:

```bash
curl -X GET "https://yourproject.supabase.co/functions/v1/hero-image-cron?cron=true&limit=20" \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

## Manual Invocation

To run the job manually through the dashboard or CLI:

```bash
curl -X POST "https://yourproject.supabase.co/functions/v1/hero-image-cron" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_AUTH_TOKEN" \
  -d '{"limit": 5}'
```

## Dependencies

This function depends on:
1. The `batch-generate-hero-images` function
2. A storage bucket named `hero-images`
3. The OpenAI API configuration