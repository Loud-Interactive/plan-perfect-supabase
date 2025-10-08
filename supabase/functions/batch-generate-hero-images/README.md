# Batch Hero Image Generator Function

This Supabase Edge Function batch processes multiple content plan outlines to generate hero images using OpenAI's GPT Image API.

## Functionality

1. Takes an optional list of content plan outline GUIDs as input
2. If no GUIDs are provided, finds outlines that have a prompt but no image
3. For each outline, generates an image using OpenAI's GPT Image API
4. Saves each image to Supabase Storage
5. Updates each content plan outline with the public URL
6. Also updates any associated tasks with the image URL

## API Endpoint

**URL**: `/batch-generate-hero-images`

**Method**: `POST`

**Request Body**:
```json
{
  "guids": ["5f7b5bde-8a0c-4a42-b7db-9e494f28809a", "6a8c6cef-9b1d-5b53-c8ec-0f585g39910b"],
  "limit": 10
}
```

Both parameters are optional:
- If `guids` is provided, only those specific outlines will be processed
- If `guids` is omitted, the function will find outlines that need images
- `limit` controls the maximum number of outlines to process (default: 10)

**Response**:
```json
{
  "success": true,
  "total": 2,
  "success_count": 1,
  "error_count": 1,
  "results": [
    {
      "guid": "5f7b5bde-8a0c-4a42-b7db-9e494f28809a",
      "title": "Example Content Plan Outline 1",
      "status": "success",
      "hero_image_url": "https://example.com/storage/hero-images/5f7b5bde-8a0c-4a42-b7db-9e494f28809a.png"
    },
    {
      "guid": "6a8c6cef-9b1d-5b53-c8ec-0f585g39910b",
      "title": "Example Content Plan Outline 2",
      "status": "error",
      "error": "Error message details"
    }
  ]
}
```

## Deployment

Deploy this function with:

```bash
supabase functions deploy batch-generate-hero-images --no-verify-jwt
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
# Process specific outlines
curl -X POST "https://yourproject.supabase.co/functions/v1/batch-generate-hero-images" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -d '{"guids": ["5f7b5bde-8a0c-4a42-b7db-9e494f28809a", "6a8c6cef-9b1d-5b53-c8ec-0f585g39910b"]}'

# Process up to 5 outlines that need images
curl -X POST "https://yourproject.supabase.co/functions/v1/batch-generate-hero-images" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -d '{"limit": 5}'
```

## Error Handling

The function handles several error cases:
- Individual outlining processing errors (continues with the next outline)
- Storage upload errors
- Database update errors
- OpenAI API errors

Each outline is processed independently, so errors with one outline won't affect the others.