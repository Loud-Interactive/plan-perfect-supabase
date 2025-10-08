# SEO Indexation Status Integration

This document describes the integration of Google Search Console (GSC) indexation status into the page_seo_recommendations table and related functions.

## Overview

The system provides automated tracking of page indexation status in Google Search Console. This helps identify pages that:
- Are not indexed
- Have indexation issues
- Need to be submitted for indexing

The data is stored directly in the `page_seo_recommendations` table alongside other SEO data for a unified view of page performance.

## Database Schema

The following fields have been added to the `page_seo_recommendations` table:

| Field                    | Type                    | Description                                         |
|--------------------------|-------------------------|-----------------------------------------------------|
| indexation_status        | TEXT                    | GSC coverage state (e.g., "Submitted and indexed")  |
| indexation_last_checked  | TIMESTAMP WITH TIME ZONE| When the indexation status was last verified        |
| indexation_emoji         | TEXT                    | Visual indicator of status (✅, 👀, etc.)           |
| indexation_details       | JSONB                   | Full JSON response from GSC inspection              |
| mobile_usability_status  | TEXT                    | Mobile usability status from GSC inspection         |
| rich_results_status      | TEXT                    | Rich results/structured data status from GSC         |
| indexation_request_count | INTEGER                 | Times indexation was requested for this URL         |
| last_indexation_requested| TIMESTAMP WITH TIME ZONE| When indexation was last requested                  |

## Available Functions

### update-seo-indexation-status

Updates indexation status for specified URLs or a batch of URLs that need updating.

**Endpoint:** `https://{SUPABASE_URL}/functions/v1/update-seo-indexation-status`

**Parameters:**
- `batchSize` (optional): Number of URLs to process (default: 50)
- `checkInLastDays` (optional): Only update URLs not checked in X days (default: 30)
- `force` (optional): If true, update all URLs regardless of last check date
- `specificUrls` (optional): Array of specific URLs to check
- `missingDataOnly` (optional): Only process URLs with no indexation data
- `prioritizeMissingData` (optional): Prioritize URLs with missing indexation data
- `checkForMissing` (optional): Check for both missing and outdated data

**Example:**
```json
{
  "batchSize": 10,
  "specificUrls": [
    "https://example.com/page1",
    "https://example.com/page2"
  ]
}
```

### cron-update-indexation

Scheduled job that prioritizes URLs and updates indexation status regularly.

**Endpoint:** `https://{SUPABASE_URL}/functions/v1/cron-update-indexation`

**Authentication:**
- Requires bearer token matching CRON_SECRET environment variable
- Or URL parameter ?secret=CRON_SECRET for testing

**Parameters:**
```json
{
  "batchSize": 30,
  "frequency": {
    "highPriority": 7,
    "mediumPriority": 14,
    "lowPriority": 30
  }
}
```

## Setting Up Cron Job

Two cron jobs are set up to maintain indexation data:

1. **Daily Full Update** - Runs at 3 AM daily to update a large batch of pages
2. **Frequent Missing Data Check** - Runs every 5 minutes to specifically update pages with no indexation data

The SQL migration file sets up these cron jobs automatically:

```sql
-- Daily comprehensive update (at 3 AM)
SELECT cron.schedule(
  'daily-indexation-update',
  '0 3 * * *',
  $$
  SELECT public.update_seo_indexation_status();
  $$
);

-- Frequent check for missing data (every 5 minutes)
SELECT cron.schedule(
  'frequent-indexation-check',
  '*/5 * * * *',
  $$
  PERFORM net.http_post(
    'https://' || current_setting('app.settings.project_ref', true) || '.supabase.co/functions/v1/update-seo-indexation-status',
    jsonb_build_object(
      'batchSize', 5,
      'missingDataOnly', true,
      'force', true
    ),
    '{}'::jsonb,
    jsonb_build_object(
      'Authorization', 'Bearer ' || get_app_secret('supabase_service_role_key'),
      'Content-Type', 'application/json'
    )
  );
  $$
);
```

These jobs use the secure `jsonb_build_object` approach for constructing the authorization header.

## Indexation Status Types

The system tracks these GSC indexation statuses:

1. **Submitted and indexed** (✅) - Page is in Google's index
2. **Crawled - currently not indexed** (👀) - Google crawled but chose not to index
3. **Discovered - currently not indexed** (👀) - Google knows about URL but hasn't crawled
4. **Duplicate without user-selected canonical** (😵) - Duplicate content issue
5. **Page with redirect** (🔀) - URL redirects to another page
6. **URL is unknown to Google** (❓) - Google has no record of the URL

## Environment Variables Required

- `GSC_CLIENT_EMAIL` - Google Service Account client email
- `GSC_PRIVATE_KEY` - Google Service Account private key
- `CRON_SECRET` - Secret for cron job authentication

## Deployment

1. Apply the database migration:
```bash
supabase db push migrations/20250514_add_indexation_status_to_seo.sql
```

2. Deploy the functions:
```bash
supabase functions deploy update-seo-indexation-status
supabase functions deploy cron-update-indexation
```