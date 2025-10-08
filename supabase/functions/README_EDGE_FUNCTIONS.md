# PagePerfect Edge Functions

This document explains the Edge Functions available for the PagePerfect system, including the ScraperAPI integration and HTML analysis.

## Setting Up Supabase Secrets

Both Edge Functions use Supabase secrets for API keys. To set them up:

```bash
# Set the ScraperAPI key
supabase secrets set SCRAPER_API_KEY=your_scraper_api_key

# Set the Anthropic API key
supabase secrets set ANTHROPIC_API_KEY=your_anthropic_api_key
```

With these secrets set, you don't need to provide the API keys in the requests.

## Available Edge Functions

### 1. scraper-api-fetch

Provides a secure interface to ScraperAPI for fetching HTML content from websites, including protected sites.

**Features:**
- Special handling for protected sites (orientaltrading.com, wayfair.com, etc.)
- Secure API key management
- Smart timeout handling
- Error detection and reporting
- Performance tracking

### 2. analyze-html-content

Analyzes HTML content using Claude 3.7 for detailed content insights.

**Features:**
- Direct integration with Anthropic's Claude API
- Detailed content analysis
- Keyword extraction
- Content quality assessment
- Improvement recommendations

## Deployment

Deploy these Edge Functions to your Supabase project:

```bash
cd supabase/functions
supabase functions deploy scraper-api-fetch --no-verify-jwt
supabase functions deploy analyze-html-content --no-verify-jwt
```

## HTML Processor UI

A browser-based UI for the Edge Functions is available at:
`/supabase/functions/scraper-api-html-processor/index.html`

This UI allows you to:
- Enter URLs to scrape
- Configure ScraperAPI settings
- View and save HTML content
- Analyze content with Claude
- Handle protected sites with special settings

## Using the Edge Functions in Your Code

### Scraping HTML with ScraperAPI

```javascript
const response = await fetch('https://your-project-ref.supabase.co/functions/v1/scraper-api-fetch', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    url: 'https://example.com',
    // scraperApiKey: 'your-scraper-api-key', // Optional if SCRAPER_API_KEY secret is set
    premium: true,
    ultraPremium: false,
    render: true,
    timeout: 60000
  })
});

const data = await response.json();
if (data.success) {
  const html = data.html;
  // Process the HTML content
}
```

### Analyzing HTML with Claude

```javascript
const response = await fetch('https://your-project-ref.supabase.co/functions/v1/analyze-html-content', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    html: htmlContent,
    url: 'https://example.com',
    // anthropicKey: 'your-anthropic-api-key', // Optional if ANTHROPIC_API_KEY secret is set
    model: 'claude-3-7-sonnet-20250219' // Optional
  })
});

const data = await response.json();
if (data.success) {
  const analysis = data.analysis;
  // Use the analysis results
}
```

## Integration with PagePerfect

These Edge Functions can be integrated into the PagePerfect workflow:

1. Use `scraper-api-fetch` to retrieve HTML content from URLs
2. Process the HTML content with your PagePerfect logic
3. Use `analyze-html-content` to get deeper insights if needed
4. Store results in your database

## ScraperAPI Considerations

- **API Key**: You'll need a ScraperAPI account and API key from [scraperapi.com](https://www.scraperapi.com/)
- **Costs**: ScraperAPI charges per successful request, with premium and ultra premium tiers costing more
- **Rate Limits**: Consider implementing your own rate limiting logic for batch processing

## Anthropic API Considerations

- **API Key**: You'll need an Anthropic API key for Claude
- **Costs**: Anthropic charges per token for both input and output
- **Model Selection**: The default model is claude-3-7-sonnet, but you can specify others

## Security Notes

For production use, consider adding authentication to the Edge Functions:

```bash
supabase functions deploy scraper-api-fetch
supabase functions deploy analyze-html-content
```

This will require proper JWT authentication for requests, enhancing security.

## Troubleshooting

Common issues:
- **CORS errors**: Make sure your requests include the proper headers
- **API key errors**: Verify your ScraperAPI and Anthropic API keys
- **Timeouts**: For protected sites, increase the timeout value and use premium tiers
- **Large HTML content**: Consider limiting HTML size for analysis to avoid token limits