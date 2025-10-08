# Get Classification Results Edge Function

This Supabase Edge Function retrieves results from a keyword classification job. It supports pagination, filtering, and different output formats.

## Features

- Paginated results to handle large datasets
- CSV or JSON output formats
- Filtering by relevance, keyword, category, or business model
- User authentication and access control
- Job status and progress information

## Usage

### Request Format

This is a GET endpoint with the following query parameters:

- `jobId` (required): UUID of the classification job
- `format` (optional): Output format, either 'json' (default) or 'csv'
- `page` (optional): Page number for pagination, defaults to 1
- `pageSize` (optional): Number of results per page, defaults to 100 (max 1000)
- `relevantOnly` (optional): Set to 'true' to only include relevant keywords
- `keyword` (optional): Filter results by keyword (partial match)
- `category` (optional): Filter results by primary, secondary, or tertiary category (partial match)
- `businessModel` (optional): Filter results by business relationship model (partial match)

Example URL:
```
/functions/v1/get-classification-results?jobId=123e4567-e89b-12d3-a456-426614174000&format=json&page=1&pageSize=100&relevantOnly=true
```

### Authentication

This endpoint requires a valid JWT token in the Authorization header:

```
Authorization: Bearer your-jwt-token
```

### Response Format (JSON)

```json
{
  "job": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "domain": "example.com",
    "status": "completed",
    "progress": 100,
    "totalBatches": 500,
    "createdAt": "2025-05-21T12:34:56.789Z",
    "error": null
  },
  "results": [
    {
      "keyword": "example keyword",
      "primary": "Category",
      "secondary": "Subcategory",
      "tertiary": "Further subcategory",
      "relevant": "Yes",
      "reasoning": "This keyword is relevant because...",
      "business_relationship_model": "B2C"
    },
    ...
  ],
  "pagination": {
    "page": 1,
    "pageSize": 100,
    "totalCount": 25000,
    "totalPages": 250
  },
  "filters": {
    "relevantOnly": true,
    "keyword": null,
    "category": null,
    "businessModel": null
  }
}
```

### Response Format (CSV)

When format=csv is specified, the response will be a CSV file with the following headers:
```
Keyword,Primary,Secondary,Tertiary,Relevant,Reasoning,BusinessRelationshipModel
```

## Deployment

Deploy this function using the Supabase CLI:

```bash
supabase functions deploy get-classification-results
```

## Related Functions

- `submit-classification-job`: Creates a new classification job
- `process-classification-batch`: Processes a batch of keywords
- `classify-keyword`: Performs the actual keyword classification
- `check-classification-status`: Checks the status of a classification job