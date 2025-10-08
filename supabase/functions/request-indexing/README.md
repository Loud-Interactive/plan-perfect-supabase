# Request Indexing API

This edge function provides an integration with Google Search Console's Indexing API to request indexing for URLs.

## Features

- Submit URLs for Google indexing using Google Search Console Indexing API
- Automatic domain detection from URL
- Support for different site URL formats (http://, https://, sc-domain:)
- Optional database logging of indexing requests

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
supabase functions deploy request-indexing --no-verify-jwt
```

## API Usage

```http
POST /functions/v1/request-indexing
```

Body parameters:

```json
{
  "url": "https://example.com/page-to-index",
  "siteUrl": "example.com" // Optional, will be extracted from URL if not provided
}
```

### Response

Success:

```json
{
  "success": true,
  "url": "https://example.com/page-to-index",
  "siteUrl": "sc-domain:example.com",
  "result": {
    "urlNotificationMetadata": {
      "url": "https://example.com/page-to-index",
      "latestUpdate": {
        "url": "https://example.com/page-to-index",
        "type": "URL_UPDATED",
        "notifyTime": "2023-01-01T12:00:00.000Z"
      }
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

## Rate Limits

Please be aware of Google's rate limits for the Indexing API:

- Daily limit: Typically 200 URLs per day
- Hourly limit: 600 notifications per hour (across all URLs)

The function will return appropriate error messages if rate limits are exceeded.