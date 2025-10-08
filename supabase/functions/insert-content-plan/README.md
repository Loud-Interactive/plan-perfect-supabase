# Insert Content Plan Edge Function

This function provides an API endpoint to insert or update content plans in the database and handles:

1. Parsing markdown table format for content plan
2. Converting table to JSON array for the content_plan field
3. Storing in content_plans table
4. Also storing in incoming_plan_items if brand_name is provided
5. Error handling and CORS support

## Deployment

Deploy this function to your Supabase project:

```bash
cd /path/to/your/project
supabase functions deploy insert-content-plan --project-ref YOUR_PROJECT_REF
```

Set the required environment variables in the Supabase dashboard:
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY

## Usage

### With cURL

```bash
curl -X POST 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/insert-content-plan' \
  -H 'Authorization: Bearer YOUR_ANON_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "domain_name": "example.com",
    "keyword": "reputation management",
    "brand_name": "Example Brand",
    "email": "user@example.com",
    "content_plan_table": "| Day | Hub Number | Spoke Number | Post Title | Keyword | URL Slug | CPC | Difficulty | Volume |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n| | 1 | | Brand Reputation Management: Elevate Your Business Image with Proven Expert Strategies | brand reputation management | brand-reputation-management-elevate-business-image | 15.0 | 27 | 4300 |..."
  }'
```

### With JavaScript

```javascript
const response = await fetch('https://YOUR_PROJECT_REF.supabase.co/functions/v1/insert-content-plan', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_ANON_KEY',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    domain_name: "example.com",
    keyword: "reputation management",
    brand_name: "Example Brand",
    email: "user@example.com",
    content_plan_table: "| Day | Hub Number | Spoke Number | Post Title | Keyword | URL Slug | CPC | Difficulty | Volume |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n| | 1 | | Brand Reputation Management: Elevate Your Business Image with Proven Expert Strategies | brand reputation management | brand-reputation-management-elevate-business-image | 15.0 | 27 | 4300 |..."
  })
});

const data = await response.json();
```

## Response Format

For successful operations:
```json
{
  "data": [
    {
      "guid": "uuid-of-content-plan",
      "domain_name": "example.com",
      "keyword": "reputation management",
      "content_plan": "[...]",
      "content_plan_table": "...",
      "timestamp": "2025-03-20T08:10:53.026+00:00"
    }
  ],
  "error": null
}
```

For errors:
```json
{
  "error": "Error message details"
}
```