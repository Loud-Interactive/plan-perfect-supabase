# Bulk HTML Processor

A comprehensive tool for analyzing multiple HTML pages by URL in batch.

## Overview

The Bulk HTML Processor allows you to:

1. Upload a CSV file with URLs and target keywords
2. Process multiple URLs in parallel with configurable concurrency
3. Analyze HTML content for SEO metrics including:
   - Keyword density
   - Heading structure
   - Word count
   - Overall SEO score
4. Export detailed analysis results to CSV

## Implementation

This solution consists of two main components:

1. **`process-direct-html` Edge Function**: Analyzes HTML content and returns SEO metrics
2. **`bulk-html-processor.html` UI**: Interface for batch processing of URLs

## Deployment

### 1. Deploy the Edge Function

```bash
cd supabase/functions
supabase functions deploy process-direct-html --no-verify-jwt
```

### 2. Deploy the HTML Interface

You can either:

- Host the HTML file in your Supabase storage bucket
- Serve it from your own server
- Open it locally in a browser

## Usage

1. Open the `bulk-html-processor.html` file in your browser
2. Configure the API endpoint (default is set to the Supabase deployment)
3. Upload a CSV file with URLs and optional target keywords
4. Configure the column mapping (automatically detects URL and keyword columns)
5. Set the number of concurrent requests (default: 5)
6. Click "Start Processing"
7. View results and export as needed

## CSV Format

The CSV file should contain:

- A column with URLs to analyze
- Optional column with target keywords for each URL

Example:
```
url,keyword
https://example.com/page1,seo analysis
https://example.com/page2,keyword research
```

## Features

- **Parallel Processing**: Process multiple URLs simultaneously
- **CORS Proxy Support**: Handle cross-origin restrictions
- **Detailed Analysis**: Get comprehensive SEO metrics for each URL
- **Interactive Dashboard**: Filter and sort results
- **Detailed View**: Examine individual URL analysis
- **CSV Export**: Export all results for further processing
- **Error Handling**: Robust error recovery for failed requests

## Technical Notes

- The HTML processor uses the Cheerio library for HTML parsing
- The interface fetches HTML content directly or through a CORS proxy
- Concurrency is managed by a worker pool system
- CSV parsing handles both quoted and unquoted formats
- All processing happens client-side for privacy and performance

## Troubleshooting

- If URLs fail to fetch due to CORS issues, configure a CORS proxy
- For large batches, reduce the concurrency to avoid rate limiting
- If the analysis API returns errors, check the Edge Function logs

## Customization

You can modify the HTML interface to suit your needs:
- Change the default API endpoint
- Adjust the scoring algorithm in the Edge Function
- Modify the UI styling and layout
- Add additional analysis metrics