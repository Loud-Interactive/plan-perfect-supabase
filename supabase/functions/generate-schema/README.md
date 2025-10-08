# Generate Schema Edge Function

This Supabase Edge Function generates JSON-LD schema markup for content based on its URL and saves it to the corresponding content plan outline.

## Purpose

The function automatically generates structured data (JSON-LD schema) for content to enhance SEO by:
1. Converting a content URL to markdown
2. Using AI (Groq) to generate appropriate schema markup
3. Saving the generated schema to the content_plan_outlines table

## Usage

```
POST https://[YOUR_PROJECT_REF].supabase.co/functions/v1/generate-schema
```

### Request Body Options

The function supports multiple ways to identify content:

#### Option 1: Just provide the content_plan_outline_guid
```json
{
  "content_plan_outline_guid": "43767695-8126-4400-889f-82a1c15ae81c"
}
```
The function will:
1. First try to find the live_post_url in the content_plan_outlines table
2. If not found there, it will check the tasks table using the content_plan_outline_guid
3. Uses the most recent task entry if multiple exist

#### Option 2: Provide both outline GUID and URL
```json
{
  "content_plan_outline_guid": "43767695-8126-4400-889f-82a1c15ae81c",
  "live_post_url": "https://example.com/blog-post"
}
```

#### Option 3: Legacy task_id support
```json
{
  "task_id": "b0b8ad60-dfc6-4a2c-bae1-4dcaddc54559"
}
```
The function will fetch the live_post_url from the tasks table.

### Example with cURL

```bash
curl -X POST "https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/generate-schema" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpzeXBjdGRoeW5zZHFyZmlmdmRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDA2OTIwMzIsImV4cCI6MjA1NjI2ODAzMn0.2QxOFFLzmp6VByWImiw6zDz3rWy-5hsvEHw3EMemIKY" \
  -H "Content-Type: application/json" \
  -d '{"content_plan_outline_guid": "43767695-8126-4400-889f-82a1c15ae81c"}'
```

### Example with JavaScript

```javascript
const generateSchema = async (outlineGuid) => {
  const response = await fetch('https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/generate-schema', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpzeXBjdGRoeW5zZHFyZmlmdmRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDA2OTIwMzIsImV4cCI6MjA1NjI2ODAzMn0.2QxOFFLzmp6VByWImiw6zDz3rWy-5hsvEHw3EMemIKY'
    },
    body: JSON.stringify({
      content_plan_outline_guid: outlineGuid
    })
  });
  
  return await response.json();
};
```

## Response Format

```json
{
  "success": true,
  "message": "Schema generated and saved successfully"
}
```

## Error Responses

```json
{
  "error": "No live_post_url found for outline 43767695-8126-4400-889f-82a1c15ae81c"
}
```

## Automatic Triggering

This function can be triggered automatically when the live_post_url field is updated in the content_plan_outlines table by using the database trigger defined in `outline-schema-trigger.sql`.

## Process Flow

1. Function receives a content_plan_outline_guid or task_id
2. It fetches the live_post_url from the appropriate table if not provided
3. Converts the content at that URL to markdown
4. Extracts domain data for additional context
5. Uses Groq AI to generate detailed JSON-LD schema markup
6. Saves the generated schema to the content_plan_outlines or tasks table

## Deployment

Deploy the function using the Supabase CLI:

```bash
supabase functions deploy generate-schema
```

## Related

- `get-schema`: Edge function to retrieve generated schema
- `outline-schema-trigger.sql`: Database trigger to automatically call this function