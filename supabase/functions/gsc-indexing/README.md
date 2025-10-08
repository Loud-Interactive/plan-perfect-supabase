# Google Search Console Indexing API

This edge function provides integration with Google Search Console API for requesting indexing of URLs, checking indexation status, and retrieving sitemaps.

## Features

- Request indexing for URLs
- Check indexation status of URLs
- Retrieve list of sitemaps for a given site

## Configuration

Before using this function, you need to set up a Google Cloud Service Account with access to the Google Search Console API. Follow these steps:

1. Create a Google Cloud project
2. Enable the "Google Search Console API" and "Indexing API" for your project
3. Create a service account
4. Generate a JSON key for the service account
5. Add the service account as an owner to your Google Search Console property

Then set the following secrets in your Supabase project:

```bash
supabase secrets set GSC_CLIENT_EMAIL="your-service-account@your-project.iam.gserviceaccount.com"
supabase secrets set GSC_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_PRIVATE_KEY_HERE\n-----END PRIVATE KEY-----\n"
```

## Deployment

```bash
supabase functions deploy gsc-indexing --no-verify-jwt
```

## API Usage

### Request Indexing

```http
POST /functions/v1/gsc-indexing/request-indexing
```

Body parameters:

```json
{
  "url": "https://example.com/page-to-index",
  "siteUrl": "example.com" // Optional, will be extracted from URL if not provided
}
```

### Get Sitemaps

```http
POST /functions/v1/gsc-indexing/get-sitemaps
```

Body parameters:

```json
{
  "siteUrl": "example.com"
}
```

### Check Indexation

```http
POST /functions/v1/gsc-indexing/check-indexation
```

Body parameters:

```json
{
  "url": "https://example.com/page-to-check",
  "siteUrl": "example.com" // Optional, will be extracted from URL if not provided
}
```
