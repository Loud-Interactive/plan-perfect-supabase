# Hero Image Generator Function

This Supabase Edge Function generates hero images for content plan outlines using OpenAI's GPT Image API.

## Functionality

1. Takes a content plan outline GUID as input
2. Retrieves the hero image prompt for the outline
3. Generates an image using OpenAI's GPT Image API
4. Saves the image to Supabase Storage
5. Updates the content plan outline with the public URL
6. Also updates any associated tasks with the image URL

## API Endpoint

**URL**: `/generate-hero-image`

**Method**: `POST`

**Request Body**:
```json
{
  "guid": "5f7b5bde-8a0c-4a42-b7db-9e494f28809a"
}
```

**Response**:
```json
{
  "success": true,
  "guid": "5f7b5bde-8a0c-4a42-b7db-9e494f28809a",
  "title": "Example Content Plan Outline",
  "hero_image_url": "https://example.com/storage/hero-images/5f7b5bde-8a0c-4a42-b7db-9e494f28809a.png",
  "prompt": "The hero image prompt that was used",
  "openai_usage": {
    "total_tokens": 100,
    "input_tokens": 50,
    "output_tokens": 50
  }
}
```

## Deployment

Deploy this function with:

```bash
supabase functions deploy generate-hero-image --no-verify-jwt
```

## Environment Variables

This function requires the following environment variables:

- `OPENAI_API_KEY`: Your OpenAI API key

Set them with:

```bash
supabase secrets set OPENAI_API_KEY=sk-your-openai-api-key
```

## Storage Bucket

This function requires a public storage bucket named `hero-images`. Ensure this bucket exists and has public access enabled.

## Usage

Call the function with:

```bash
curl -X POST "https://yourproject.supabase.co/functions/v1/generate-hero-image" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -d '{"guid": "5f7b5bde-8a0c-4a42-b7db-9e494f28809a"}'
```

## Error Handling

The function handles several error cases:
- Missing GUID
- Outline not found
- Missing hero image prompt
- OpenAI API errors
- Storage upload errors
- Database update errors