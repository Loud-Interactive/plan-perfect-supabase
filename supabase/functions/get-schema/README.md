# Get Schema Edge Function

This Supabase Edge Function retrieves the schema_data for a content plan outline by its GUID.

## Purpose

The function allows clients to access JSON-LD schema data generated for specific content outlines, making it easy to:
- Embed schema markup in HTML pages
- Verify schema generation results
- Access schema data programmatically

## Usage

### GET Method

```
GET https://[YOUR_PROJECT_REF].supabase.co/functions/v1/get-schema?guid=[OUTLINE_GUID]
```

#### Example with cURL

```bash
curl -X GET "https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/get-schema?guid=43767695-8126-4400-889f-82a1c15ae81c" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpzeXBjdGRoeW5zZHFyZmlmdmRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDA2OTIwMzIsImV4cCI6MjA1NjI2ODAzMn0.2QxOFFLzmp6VByWImiw6zDz3rWy-5hsvEHw3EMemIKY"
```

### POST Method

```
POST https://[YOUR_PROJECT_REF].supabase.co/functions/v1/get-schema
```

With request body:

```json
{
  "guid": "43767695-8126-4400-889f-82a1c15ae81c"
}
```

#### Example with cURL

```bash
curl -X POST "https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/get-schema" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpzeXBjdGRoeW5zZHFyZmlmdmRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDA2OTIwMzIsImV4cCI6MjA1NjI2ODAzMn0.2QxOFFLzmp6VByWImiw6zDz3rWy-5hsvEHw3EMemIKY" \
  -H "Content-Type: application/json" \
  -d '{"guid": "43767695-8126-4400-889f-82a1c15ae81c"}'
```

## Response Format

### Success Response

```json
{
  "guid": "43767695-8126-4400-889f-82a1c15ae81c",
  "post_title": "Brand Reputation Management: Build a Trustworthy Online Presence and Stand Out Today",
  "schema_data": "{\"@context\":\"https://schema.org\",\"@type\":\"BlogPosting\",\"headline\":\"Brand Reputation Management: Build a Trustworthy Online Presence and Stand Out Today\",...}"
}
```

### No Schema Available

```json
{
  "guid": "43767695-8126-4400-889f-82a1c15ae81c",
  "post_title": "Brand Reputation Management: Build a Trustworthy Online Presence and Stand Out Today", 
  "message": "No schema data available for this outline",
  "schema_data": null
}
```

### Error Response

```json
{
  "error": "Error message details"
}
```

## Deployment

Deploy the function using the Supabase CLI:

```bash
supabase functions deploy get-schema
```

## Security and CORS

The function includes CORS headers to allow cross-origin requests. It can be called from any origin but requires a valid JWT token for authorization.

## Integration with Content Plan Workflow

This function complements the schema generation workflow by providing an easy way to access generated schema data:

1. Content plan outlines are created
2. Live post URLs are added to the outlines
3. The `outline-schema-trigger` automatically generates schema data 
4. This function allows retrieval of the generated schema data

For more information about the schema generation process, see the documentation for the `generate-schema` function and the `outline-schema-trigger` SQL trigger.