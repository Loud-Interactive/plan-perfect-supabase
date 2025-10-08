# PagePerfect Bulk Processing Guide

This document explains how to use the PagePerfect bulk processing system to process large numbers of URLs through the ScraperAPI and Claude analysis workflow.

## Overview

The bulk processing system consists of several components:

1. **Edge Functions**:
   - `bulk-process-urls` - For creating and starting batch jobs
   - `get-batch-status` - For checking batch progress
   - `get-url-data` - For retrieving detailed URL data
   - `retry-failed-urls` - For retrying failed URLs

2. **Database Tables**:
   - `page_perfect_batches` - For tracking batch jobs
   - `page_perfect_url_status` - For tracking individual URL status

3. **Web UI**:
   - `bulk-perfect-processor/index.html` - User interface for managing batches

## Setup

### 1. Deploy Edge Functions

```bash
cd supabase/functions

# Deploy the Edge Functions
supabase functions deploy bulk-process-urls --no-verify-jwt
supabase functions deploy get-batch-status --no-verify-jwt
supabase functions deploy get-url-data --no-verify-jwt
supabase functions deploy retry-failed-urls --no-verify-jwt

# Make sure the ScraperAPI and Claude Edge Functions are also deployed
supabase functions deploy scraper-api-fetch --no-verify-jwt
supabase functions deploy analyze-html-content --no-verify-jwt

# Set up the necessary secrets
supabase secrets set SCRAPER_API_KEY=your_scraper_api_key
supabase secrets set ANTHROPIC_API_KEY=your_anthropic_api_key
```

### 2. Create Database Tables

Execute the SQL in `page_perfect_batch_db_setup.sql` to create the necessary tables and policies.

## Using the Bulk Processor

1. Open the `bulk-perfect-processor/index.html` file in your browser
2. Configure the API endpoints with your Supabase project URLs
3. Upload a CSV file with URLs to process
4. Configure batch settings:
   - Client ID and Project ID (optional)
   - Batch size (how many URLs to process concurrently)
   - ScraperAPI settings (Premium, Ultra Premium, JavaScript rendering)
   - Analysis options (whether to analyze content with Claude)
   - Timeout settings
5. Start the batch processing
6. Monitor progress and view results

## Key Features

### URL Processing

The system will:
1. Fetch HTML content from each URL using ScraperAPI
2. Optionally analyze the content with Claude
3. Store the HTML and analysis in the database
4. Track the status of each URL (pending, processing, completed, error)

### Batch Management

- **Real-time progress tracking**: Monitor the status of the batch in real-time
- **URL filtering**: Filter URLs by status (pending, processing, completed, error)
- **URL details**: View the HTML content and analysis for each URL
- **Retry functionality**: Retry failed URLs with different settings
- **Export results**: Export batch results as CSV or JSON

### Smart Handling of Protected Sites

The system automatically:
- Detects URLs from protected sites (orientaltrading.com, wayfair.com, etc.)
- Suggests appropriate ScraperAPI settings
- Applies special handling for these sites

## Technical Details

### Database Schema

**page_perfect_batches**:
- `id`: UUID (primary key)
- `client_id`: Text (optional)
- `project_id`: Text (optional)
- `status`: Text (pending, processing, completed, error)
- `total_urls`: Integer
- `processed_urls`: Integer
- `successful_urls`: Integer
- `failed_urls`: Integer
- `config`: JSONB (batch configuration)
- `created_at`: Timestamp
- `updated_at`: Timestamp

**page_perfect_url_status**:
- `id`: UUID (primary key)
- `batch_id`: UUID (foreign key to page_perfect_batches)
- `url`: Text
- `status`: Text (pending, processing, completed, error)
- `errormessage`: Text (optional)
- `html`: Text (HTML content)
- `html_length`: Integer
- `analysis`: JSONB (Claude analysis)
- `created_at`: Timestamp
- `updated_at`: Timestamp

### API Endpoints

**bulk-process-urls**:
- POST: Create a new batch and start processing
- Parameters:
  - `urls`: Array of URLs to process
  - `batchSize`: Number of URLs to process concurrently
  - `clientId`: Client identifier (optional)
  - `projectId`: Project identifier (optional)
  - `premium`: Whether to use ScraperAPI Premium tier
  - `ultraPremium`: Whether to use ScraperAPI Ultra Premium tier
  - `render`: Whether to render JavaScript
  - `timeout`: Request timeout in milliseconds
  - `enableAnalysis`: Whether to analyze content with Claude

**get-batch-status**:
- GET: Get the status of a batch
- Parameters:
  - `batchId`: Batch ID
  - `limit`: Number of URLs to return (pagination)
  - `offset`: Offset for pagination
  - `status`: Filter URLs by status (optional)

**get-url-data**:
- GET: Get detailed data for a URL
- Parameters:
  - `id`: URL ID

**retry-failed-urls**:
- POST: Retry failed URLs in a batch
- Parameters:
  - `batchId`: Batch ID
  - `urlIds`: Array of URL IDs to retry (optional, defaults to all failed URLs)
  - `premium`: Whether to use ScraperAPI Premium tier (optional)
  - `ultraPremium`: Whether to use ScraperAPI Ultra Premium tier (optional)
  - `timeout`: Request timeout in milliseconds (optional)

## Troubleshooting

### Common Issues

1. **Batch creation fails**:
   - Check that the URLs are valid
   - Verify API endpoints are correct
   - Ensure your Supabase project has the necessary tables

2. **URLs fail to process**:
   - Check the error messages
   - For bot protection errors, try enabling Ultra Premium tier
   - For timeout errors, increase the timeout value

3. **Analysis is not available**:
   - Verify that ANTHROPIC_API_KEY is set
   - Ensure enableAnalysis is set to true
   - Check for errors in the URL details

### Performance Considerations

- **Batch Size**: Keep batch size under 20 to avoid overwhelming ScraperAPI
- **Premium Tier**: Always use Premium or Ultra Premium tier for protected sites
- **Timeouts**: Set timeouts of at least 60 seconds (120 seconds for protected sites)
- **JavaScript Rendering**: Always enable rendering for modern websites

## Example CSV Format

Your CSV file should contain at least one column with URLs. The system will automatically detect columns with "url" in the name, or you can manually select the column.

Example:

```
url,category,priority
https://example.com/page1,product,high
https://example.com/page2,blog,medium
https://example.com/page3,about,low
```