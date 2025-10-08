# Submit Classification Job Edge Function

This Supabase Edge Function allows users to submit large batches of keywords for classification. It creates a new job record in the database that can be processed in smaller batches.

## Features

- Submit thousands of keywords at once
- Automatic batch size calculation
- User authentication and authorization
- Supports custom metadata
- Domain normalization for consistency
- Duplicate keyword removal

## Usage

### Request Format

```json
{
  "domain": "example.com",
  "keywords": ["keyword1", "keyword2", "...thousands more..."],
  "suggestedCategories": ["Category1", "Category2"],
  "preferencesPerfect": {
    "domain": "example.com",
    "brand_name": "Example Brand",
    "company_name": "Example Company",
    "synopsis": "Description of the company",
    "elevator_pitch": "Short elevator pitch",
    "industry": "Technology",
    "business_goals": "Goals of the business",
    "usp": "Unique selling proposition",
    "key_differentiators": "What makes the company unique",
    "client_persona": "Target client description",
    "market_focus": "Market focus areas"
  },
  "batchSize": 50,
  "metadata": {
    "projectId": "123",
    "notes": "Additional information"
  }
}
```

### Response Format

```json
{
  "message": "Classification job created successfully with 25000 keywords",
  "job": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "status": "pending",
    "totalKeywords": 25000,
    "totalBatches": 500,
    "batchSize": 50,
    "created": "2025-05-21T12:34:56.789Z"
  }
}
```

## Authentication

This endpoint requires a valid JWT token in the Authorization header:

```
Authorization: Bearer your-jwt-token
```

## Deployment

Deploy this function using the Supabase CLI:

```bash
supabase functions deploy submit-classification-job
```

## Database Tables

This function uses the following database tables:

- `classification_jobs`: Stores information about keyword classification jobs
- `classification_results`: Stores the results of keyword classifications

Refer to the SQL migration file (`migrations/20250521_classification_jobs_tables.sql`) for the complete database schema.