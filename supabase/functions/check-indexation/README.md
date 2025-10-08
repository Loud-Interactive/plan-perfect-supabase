# Check Indexation API

This edge function provides an integration with Google Search Console's URL Inspection API to check the indexation status of URLs.

## Features

- Check if a URL is indexed in Google using the URL Inspection API
- Get detailed indexation status including coverage state
- Emoji indicators for quick status assessment
- Automatic domain detection from URL
- Optional database logging of indexation checks

## Configuration

This function uses a shared Google Search Console authentication setup via the `GSC_CREDENTIALS` environment variable, which should contain a JSON string with the following structure:

```json
{
  "client_email": "your-service-account@your-project.iam.gserviceaccount.com",
  "private_key": "-----BEGIN PRIVATE KEY-----\nYOUR_PRIVATE_KEY_HERE\n-----END PRIVATE KEY-----\n"
}
```

You can set this environment variable using:

```bash
supabase secrets set GSC_CREDENTIALS='{"client_email":"your-service-account@your-project.iam.gserviceaccount.com","private_key":"-----BEGIN PRIVATE KEY-----\nYOUR_PRIVATE_KEY_HERE\n-----END PRIVATE KEY-----\n"}'
```

## Deployment

```bash
supabase functions deploy check-indexation --no-verify-jwt
```

## API Usage

```http
POST /functions/v1/check-indexation
```

Body parameters:

```json
{
  "url": "https://example.com/page-to-check",
  "siteUrl": "example.com" // Optional, will be extracted from URL if not provided
}
```

### Response

Success:

```json
{
  "success": true,
  "url": "https://example.com/page-to-check",
  "siteUrl": "sc-domain:example.com",
  "coverageState": "Submitted and indexed",
  "emoji": "✅",
  "status": {
    "indexStatusResult": {
      "coverageState": "Submitted and indexed",
      "robotsTxtState": "ALLOWED",
      "indexingState": "INDEXING_ALLOWED",
      "lastCrawlTime": "2023-01-01T12:00:00.000Z",
      "pageFetchState": "SUCCESSFUL",
      "googleCanonical": "https://example.com/page-to-check",
      "userCanonical": "https://example.com/page-to-check"
    }
  }
}
```

Error:

```json
{
  "success": false,
  "error": "Service account does not have access to this site"
}
```

## Indexation Status Values

The `coverageState` field can have the following values:

- `Submitted and indexed` (✅): URL is in Google's index
- `Crawled - currently not indexed` (👀): Google has crawled the URL but has chosen not to index it
- `Discovered - currently not indexed` (👀): Google knows about the URL but hasn't crawled it yet
- `Page with redirect` (🔀): URL redirects to another page
- `Duplicate without user-selected canonical` (😵): URL is considered a duplicate of another page
- `URL is unknown to Google` (❓): Google doesn't know about this URL yet

## Rate Limits

Please be aware of Google's rate limits for the URL Inspection API:

- Daily limit: Typically 2,000 inspections per day
- Per minute limit: 600 requests per minute

The function will return appropriate error messages if rate limits are exceeded.