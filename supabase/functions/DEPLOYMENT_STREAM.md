# Schema Generation Streaming API - Deployment Instructions

## 1. Set up environment variables

In the Supabase dashboard, set the following environment variables:

- `GROQ_API_KEY`: Your Groq API key

## 2. Deploy the Edge Function

```bash
supabase functions deploy generate-schema-stream
```

## 3. Test the function

You can test the function by sending a POST request with a URL:

```javascript
const response = await fetch(
  'https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/generate-schema-stream',
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpzeXBjdGRoeW5zZHFyZmlmdmRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDA2OTIwMzIsImV4cCI6MjA1NjI2ODAzMn0.2QxOFFLzmp6VByWImiw6zDz3rWy-5hsvEHw3EMemIKY'
    },
    body: JSON.stringify({
      url: 'https://example.com/blog-post'
    })
  }
);

// The response is a stream that you can read with a reader
const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  
  const text = decoder.decode(value);
  console.log(text); // Process each chunk
}
```

## Integration with Front-end

This streaming function can be integrated with your frontend to provide real-time updates:

1. The function returns a text stream with two sections:
   - Progress updates inside `<think>...</think>` tags
   - The final JSON-LD schema after the thinking tags

2. Your front-end can parse this stream to:
   - Show progress updates in a UI element
   - Display the final schema when complete

## Additional Information

- The Edge Function has a 60-second timeout. For very large articles, you may need to implement a more robust solution.
- If you encounter any issues, check the function logs in the Supabase dashboard.
- The function uses an external service for converting URLs to markdown, which requires an API key that is already hardcoded in the function.