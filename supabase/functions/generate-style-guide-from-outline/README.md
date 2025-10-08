# Style Guide Generation from Content Plan Outline

This Supabase Edge Function generates a writing style guide based on content associated with a content plan outline GUID. It extracts content from the tasks table, converts it from HTML to Markdown, and then uses Claude to create a comprehensive style guide that captures the essence of the writing style.

## Purpose

The function serves to automate the creation of style guides from existing content, which can be used to:

1. Ensure consistency across multiple pieces of content
2. Guide AI-powered content generation to maintain a consistent brand voice
3. Provide writers with detailed information about the expected writing style for a particular project

## Function Flow

1. Receive a `content_plan_outline_guid` in the request
2. Query the `tasks` table to retrieve the content associated with this GUID
3. Convert the HTML content to Markdown format
4. Use Claude AI to analyze the Markdown content and generate a comprehensive style guide
5. Store the style guide in the `style_guides` table
6. Update the task's `style_guide_id` and `style_guide_status` fields

## API Endpoint

`POST /functions/v1/generate-style-guide-from-outline`

### Request Body

```json
{
  "content_plan_outline_guid": "uuid-of-content-plan-outline"
}
```

### Response

```json
{
  "content_plan_outline_guid": "uuid-of-content-plan-outline",
  "style_guide": "The generated style guide content...",
  "thinking": "Claude's thinking process (if available)",
  "save_status": {
    "success": true,
    "message": "Style guide saved successfully",
    "style_guide_id": "uuid-of-saved-style-guide"
  }
}
```

## Database Tables

### style_guides

This function requires a `style_guides` table with the following structure:

```sql
CREATE TABLE IF NOT EXISTS "style_guides" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "content_plan_outline_guid" UUID NOT NULL,
  "task_id" UUID,
  "style_guide" TEXT NOT NULL,
  "thinking" TEXT,
  "source_content_length" INTEGER,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### tasks

The function expects the `tasks` table to have the following columns:
- `task_id`
- `content_plan_outline_guid`
- `content` (containing HTML content)
- `style_guide_id`
- `style_guide_status`

## Environment Variables

- `SUPABASE_URL`: The URL of your Supabase project
- `SUPABASE_SERVICE_ROLE_KEY`: The service role key for your Supabase project
- `ANTHROPIC_API_KEY`: API key for Anthropic's Claude service

## Dependencies

- `@supabase/supabase-js`: For interacting with Supabase
- `@anthropic-ai/sdk`: For interacting with Claude AI
- `turndown`: For converting HTML to Markdown

## Deployment

Deploy this function to your Supabase project using the Supabase CLI:

```bash
supabase functions deploy generate-style-guide-from-outline
```

## Example Usage

```javascript
// Example client-side call
const response = await fetch(
  'https://your-project-ref.supabase.co/functions/v1/generate-style-guide-from-outline',
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${supabaseKey}`
    },
    body: JSON.stringify({
      content_plan_outline_guid: '123e4567-e89b-12d3-a456-426614174000'
    })
  }
);

const data = await response.json();
console.log(data.style_guide);
```