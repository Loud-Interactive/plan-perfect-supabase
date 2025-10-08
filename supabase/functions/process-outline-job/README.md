# Process Outline Job Function

This Supabase Edge Function handles the AI-powered outline generation workflow.

## Purpose

This is the main worker function that:
1. Determines search terms with Claude AI
2. Searches for relevant content using Jina Search
3. Analyzes search results with Claude AI
4. Generates an outline based on analysis
5. Tracks progress throughout the process

## Deployment

```bash
supabase functions deploy process-outline-job
```

## Environment Variables

This function requires several environment variables:
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY
- ANTHROPIC_API_KEY

## Usage

This function is not typically called directly by users - it's invoked by the `generate-outline` function. However, you can call it directly if needed:

```bash
curl -X POST 'https://[YOUR-PROJECT-REF].supabase.co/functions/v1/process-outline-job' \
  -H 'Authorization: Bearer [YOUR-SERVICE-KEY]' \
  -H 'Content-Type: application/json' \
  -d '{
    "job_id": "job-id-from-generate-outline"
  }'
```

### Request Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| job_id | string | Yes | ID of the job to process |

### Response

```json
{
  "success": true,
  "message": "Outline generation completed",
  "job_id": "job-id",
  "outline": {
    "title": "How to Choose the Best Kitchen Knives",
    "sections": [
      {
        "title": "Introduction",
        "subheadings": ["Why Quality Knives Matter", "Understanding Knife Basics", "What to Expect in This Guide"]
      },
      // More sections...
    ]
  }
}
```

## Process Steps

1. **Job Initialization**: Fetches job details from database
2. **Search Term Generation**: Uses Claude AI to generate relevant search terms
3. **Content Search**: Searches for content using Jina Search API
4. **Content Analysis**: Analyzes search results with Claude AI
5. **Outline Generation**: Creates a structured outline with Claude AI
6. **Database Storage**: Saves the outline and updates job status

## Fault Tolerance

The function includes robust error handling and fallback mechanisms:
- If search terms fail, uses the post keyword
- If searching fails, uses simpler fallback outline
- If outline generation fails, creates a simplified outline
- Updates job status to 'failed' if critical errors occur

## Related Functions

- `generate-outline`: Initiates the outline generation process
- `get-outline-status`: Checks the status of an outline generation job
- `generate-outline-report`: Creates an HTML report for an outline job