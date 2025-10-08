# Generate Schema Stream Edge Function

This Supabase Edge Function generates JSON-LD schema markup for content based on its URL and streams the results in real-time.

## Purpose

The function automatically generates structured data (JSON-LD schema) for content to enhance SEO and provides a streaming response for real-time UI updates:

1. Streams the entire generation process with progress updates
2. Converts a content URL to markdown
3. Uses AI (Groq) to generate appropriate schema markup
4. Returns the generated schema as a text stream

## Usage

```
POST https://[YOUR_PROJECT_REF].supabase.co/functions/v1/generate-schema-stream
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

#### Option 4: Direct URL (for testing)
```json
{
  "url": "https://example.com/blog-post"
}
```

### Example with fetch() and Streaming

```javascript
const streamSchema = async (outlineGuid) => {
  const response = await fetch('https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/generate-schema-stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpzeXBjdGRoeW5zZHFyZmlmdmRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDA2OTIwMzIsImV4cCI6MjA1NjI2ODAzMn0.2QxOFFLzmp6VByWImiw6zDz3rWy-5hsvEHw3EMemIKY'
    },
    body: JSON.stringify({
      content_plan_outline_guid: outlineGuid
    })
  });

  // Handle streaming response
  const reader = response.body.getReader();
  let receivedText = '';
  let isThinking = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    // Convert the chunk to text
    const chunk = new TextDecoder().decode(value);
    receivedText += chunk;
    
    // Check for thinking mode markers
    if (chunk.includes('<think>')) {
      isThinking = true;
    } else if (chunk.includes('</think>')) {
      isThinking = false;
      // Clear thinking output if you don't want to show it
      receivedText = receivedText.replace(/<think>[\s\S]*?<\/think>/g, '');
    }
    
    // Update UI with the received text
    if (isThinking) {
      // Show thinking progress (optional)
      updateThinkingProgress(chunk);
    } else {
      // Update the schema display
      updateSchemaDisplay(receivedText);
    }
  }
  
  return receivedText;
};

// Example UI update functions
function updateThinkingProgress(chunk) {
  // Extract progress information from the chunk
  const progressElement = document.getElementById('progress');
  if (progressElement) {
    progressElement.textContent += chunk;
  }
}

function updateSchemaDisplay(schema) {
  // Update the schema display
  const schemaElement = document.getElementById('schema');
  if (schemaElement) {
    schemaElement.textContent = schema;
  }
}
```

## Stream Response Format

The response is a text stream with two main sections:

1. A "thinking" section wrapped in `<think>...</think>` tags that includes progress updates:
```
<think>
Starting schema generation for URL: https://example.com/blog-post

Step 1: Converting URL to Markdown...
Successfully converted URL to Markdown (15243 characters)

Step 2: Extracting domain preferencesPerfect data...
Extracted domain: example.com
Domain preferencesPerfect data retrieved successfully
Synopsis: Example website specializing in high-quality content...
Schema template and generation prompt obtained

Step 3: Generating schema with AI...
Sending request to AI...
Receiving and processing response from AI...
Workflow complete. Streaming schema to user...
</think>
```

2. The actual JSON-LD schema (outside the think tags):
```json
{
  "@context": "https://schema.org",
  "@type": "BlogPosting",
  "headline": "Example Blog Post Title",
  "datePublished": "2024-01-15T08:00:00+00:00",
  ...
}
```

## Deployment

Deploy the function using the Supabase CLI:

```bash
supabase functions deploy generate-schema-stream
```

## Related

- `generate-schema`: Non-streaming version of this function
- `get-schema`: Edge function to retrieve generated schema