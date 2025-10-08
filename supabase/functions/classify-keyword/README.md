# Classify Keyword Edge Function

This Supabase Edge Function classifies keywords for a domain using the DeepSeek API. The function takes a list of keywords and domain information and returns classification results including primary, secondary, and tertiary categories, relevance, reasoning, and business relationship model.

## Features

- Classifies keywords using DeepSeek API's reasoning capabilities
- Supports batch processing of keywords
- Handles retry logic for API failures
- Provides comprehensive error handling
- Supports optional database integration for tracking job progress
- Uses normalization for consistent domain handling

## Required Environment Variables

- `DEEPSEEK_API_KEY`: API key for DeepSeek
- `SUPABASE_URL`: Your Supabase URL (automatically set in Supabase)
- `SUPABASE_SERVICE_ROLE_KEY`: Service role key for Supabase (automatically set in Supabase)

## Usage

### Request Format

```json
{
  "domain": "example.com",
  "keywords": ["keyword1", "keyword2", "keyword3"],
  "ppData": {
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
  "suggestedCategories": ["Category1", "Category2"],
  "previousResults": [], 
  "jobId": "optional-job-id-for-db-tracking"
}
```

### Response Format

```json
{
  "results": [
    {
      "Keyword": "keyword1",
      "Primary": "Category",
      "Secondary": "Subcategory",
      "Tertiary": "Further category",
      "Relevant": "Yes",
      "Reasoning": "This keyword is relevant because...",
      "BusinessRelationshipModel": "B2C"
    }
  ],
  "complete": true,
  "missingCount": 0,
  "success": true,
  "savedToDatabase": true
}
```

## Deployment

Deploy this function using the Supabase CLI:

```bash
supabase functions deploy classify-keyword
```

## Testing

Test the function locally:

```bash
supabase functions serve classify-keyword --no-verify-jwt
```

Then send a test request:

```bash
curl -X POST http://localhost:54321/functions/v1/classify-keyword \
  -H "Content-Type: application/json" \
  -d '{"domain":"example.com","keywords":["example keyword"]}'
```

## Notes

- The function uses the DeepSeek Reasoner model for classification
- Classifications are returned in a structured format suitable for further processing
- Error handling includes logging to both console and database (if available)
- Relies on utility functions from the project's shared libraries