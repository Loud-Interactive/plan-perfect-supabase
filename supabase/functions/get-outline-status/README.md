# Get Outline Status Function

This Supabase Edge Function checks the status and retrieves details of an outline generation job.

## Purpose

This function:
1. Fetches the current status of an outline generation job
2. Returns progress details (search terms, results, etc.)
3. Returns the generated outline when available
4. Provides detailed progress percentage based on status

## Deployment

```bash
supabase functions deploy get-outline-status
```

## Environment Variables

Make sure these are set in your Supabase project:
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY

## Usage

### API Request

```bash
curl 'https://[YOUR-PROJECT-REF].supabase.co/functions/v1/get-outline-status?job_id=[JOB-ID]' \
  -H 'Authorization: Bearer [YOUR-ANON-KEY]'
```

### Request Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| job_id | string | Yes | ID of the job to check |

### Response

```json
{
  "job_id": "job-id",
  "status": "completed",
  "progress": 100,
  "progressDetails": {
    "searchTerms": [
      {"search_term": "best kitchen knives for home cooks"},
      {"search_term": "chef knife vs santoku"}
    ],
    "searchResults": [
      {
        "search_term": "best kitchen knives for home cooks",
        "url": "https://example.com/best-kitchen-knives",
        "title": "10 Best Kitchen Knives for Home Cooks"
      }
    ],
    "urlAnalyses": [
      {
        "url": "https://example.com/best-kitchen-knives",
        "title": "10 Best Kitchen Knives for Home Cooks"
      }
    ],
    "counts": {
      "searchTerms": 5,
      "searchResults": 42,
      "urlAnalyses": 15
    }
  },
  "outline": {
    "title": "How to Choose the Best Kitchen Knives",
    "sections": [
      {
        "title": "Introduction",
        "subheadings": ["Why Quality Knives Matter", "Understanding Knife Basics", "What to Expect in This Guide"]
      }
    ]
  },
  "job_details": {
    "post_title": "How to Choose the Best Kitchen Knives",
    "content_plan_keyword": "kitchen knives",
    "post_keyword": "best kitchen knives",
    "domain": "misen.com"
  },
  "created_at": "2023-06-01T12:00:00Z",
  "updated_at": "2023-06-01T12:05:30Z"
}
```

### Status Progress Values

| Status | Progress % |
|--------|------------|
| pending | 0 |
| started | 10 |
| determining_search_terms | 20 |
| running_searches | 40 |
| analyzing_results | 60 |
| generating_outline | 80 |
| completed | 100 |
| failed | 0 |

## Related Functions

- `generate-outline`: Initiates the outline generation process
- `process-outline-job`: Handles the outline generation workflow
- `generate-outline-report`: Creates an HTML report for an outline job