# ScraperAPI Edge Function

This Supabase Edge Function provides a secure server-side interface to ScraperAPI for fetching content from websites, including those with bot protection.

## Overview

The `scraper-api-fetch` Edge Function handles the communication with ScraperAPI, providing:

1. Special handling for protected sites
2. Secure API key management
3. Smart timeout handling
4. Error detection and reporting
5. Performance tracking

## Deployment

Deploy the Edge Function to your Supabase project:

```bash
cd supabase/functions
supabase functions deploy scraper-api-fetch --no-verify-jwt
```

## Usage

Call the Edge Function with the following parameters:

```javascript
const response = await fetch('https://your-project-ref.supabase.co/functions/v1/scraper-api-fetch', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    // Include auth headers as needed
  },
  body: JSON.stringify({
    url: 'https://www.example.com', // URL to scrape
    scraperApiKey: 'your-scraper-api-key', // Your ScraperAPI key
    premium: true, // Optional: Use premium tier (default: false)
    ultraPremium: false, // Optional: Use ultra premium tier (default: false)
    render: true, // Optional: Render JavaScript (default: true)
    timeout: 60000 // Optional: Timeout in milliseconds (default: 60000, or 120000 for protected sites)
  })
});

const data = await response.json();
```

## Response Format

The function returns a JSON object with the following structure:

```json
{
  "success": true,
  "html": "<!DOCTYPE html>...", // The scraped HTML content
  "url": "https://www.example.com", // The original URL
  "processingTimeMs": 1234 // Processing time in milliseconds
}
```

In case of an error:

```json
{
  "success": false,
  "error": "Error message"
}
```

## Special Handling for Protected Sites

The function automatically detects and applies special settings for these protected sites:
- orientaltrading.com (uses ultra premium tier)
- wayfair.com (uses premium tier)
- homedepot.com (uses premium tier)
- walmart.com (uses premium tier)

For these sites, the function:
- Uses premium or ultra premium tier
- Enables JavaScript rendering
- Uses a consistent session ID
- Sets a longer timeout
- Applies additional reliability settings

## Integration with HTML Processor

Update your HTML processor to use this Edge Function by replacing the direct ScraperAPI calls with calls to the Edge Function.

### Example Integration

```javascript
// In your HTML processor frontend
async function fetchUrlHtml(url) {
  const response = await fetch('/api/scraper-api-fetch', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      url,
      scraperApiKey: document.getElementById('scraperApiKey').value,
      premium: document.getElementById('useScraperApiPremium').checked,
      ultraPremium: document.getElementById('useScraperApiUltra').checked
    })
  });
  
  const data = await response.json();
  
  if (!data.success) {
    throw new Error(data.error);
  }
  
  return data.html;
}
```

## Security Considerations

Even though the Edge Function accepts the API key as a parameter, this is more secure than exposing it in client-side code because:

1. The API key is never exposed in browser network requests
2. You can add additional server-side validation
3. You can implement rate limiting and logging

For higher security, you can:
1. Store the ScraperAPI key as a Supabase secret
2. Require authentication for the Edge Function
3. Implement IP-based restrictions

## Cost Optimization

To optimize ScraperAPI costs:

1. Cache responses for frequently accessed URLs
2. Implement a staggered approach for batch processing
3. Only use premium and ultra premium tiers when necessary
4. Monitor usage through ScraperAPI dashboard

## Troubleshooting

Common issues and solutions:

1. **Timeout errors**: Increase the timeout parameter for complex pages
2. **Bot protection errors**: Use the ultra premium tier
3. **Empty responses**: Check if JavaScript rendering is enabled
4. **Rate limiting**: Implement staggered requests