# Hero Image Prompt Generation

This Supabase Edge Function generates AI image prompts for hero images based on blog content. It extracts content from the tasks table, converts it from HTML to Markdown, and then uses Claude to create a concise, descriptive prompt that captures the essence of the blog post for use with image generation models.

## Purpose

The function automates the creation of high-quality image prompts that:

1. Accurately represent the blog post's main theme and content
2. Provide specific visual descriptions for image generation
3. Ensure visual consistency with the written content
4. Save time for content creators by suggesting appropriate hero image concepts

## Function Flow

1. Receive a `content_plan_outline_guid` in the request
2. Query the `tasks` table to retrieve the content associated with this GUID
3. Convert the HTML content to Markdown format
4. Use Claude AI to analyze the Markdown content and generate an image prompt
5. Store the image prompt in the `hero_image_prompts` table
6. Update the task's `hero_image_prompt_id` and `hero_image_status` fields

## API Endpoint

`POST /functions/v1/generate-hero-image-prompt`

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
  "image_prompt": "The generated image prompt...",
  "thinking": "Claude's thinking process (if available)",
  "save_status": {
    "success": true,
    "message": "Hero image prompt saved successfully",
    "hero_image_prompt_id": "uuid-of-saved-prompt"
  }
}
```

## Database Tables

### hero_image_prompts

This function requires a `hero_image_prompts` table with the following structure:

```sql
CREATE TABLE IF NOT EXISTS "hero_image_prompts" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "content_plan_outline_guid" UUID NOT NULL,
  "task_id" UUID,
  "image_prompt" TEXT NOT NULL,
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
- `hero_image_prompt_id`
- `hero_image_status`

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
supabase functions deploy generate-hero-image-prompt
```

## Example Usage

```javascript
// Example client-side call
const response = await fetch(
  `${supabaseUrl}/functions/v1/generate-hero-image-prompt`,
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
console.log(data.image_prompt);
```

## Next Steps After Prompt Generation

Once you have the image prompt, you can:

1. Use it with image generation services like DALL-E, Midjourney, or Stable Diffusion
2. Manually review and adjust the prompt if needed
3. Save the generated image and associate it with the blog post
4. Display the hero image at the top of the blog post