# Get Sitemaps API

This edge function provides an integration with Google Search Console's API to retrieve sitemaps for a given site.

## Features

- Fetch all sitemaps registered in Google Search Console for a site
- Get sitemap metadata including submission date, errors, and warnings
- Support for different site URL formats (http://, https://, sc-domain:)

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
supabase functions deploy get-sitemaps --no-verify-jwt
```

## API Usage

```http
POST /functions/v1/get-sitemaps
```

Body parameters:

```json
{
  "siteUrl": "example.com"
}
```

### Response

Success:

```json
{
  "success": true,
  "siteUrl": "sc-domain:example.com",
  "sitemapCount": 2,
  "sitemaps": [
    {
      "path": "https://example.com/sitemap.xml",
      "lastSubmitted": "2023-01-01T12:00:00.000Z",
      "lastDownloaded": "2023-01-01T12:30:00.000Z",
      "warnings": 0,
      "errors": 0,
      "isSitemapsIndex": true,
      "isPending": false,
      "contents": [
        {
          "type": "web",
          "submitted": 100,
          "indexed": 95
        }
      ]
    },
    {
      "path": "https://example.com/posts-sitemap.xml",
      "lastSubmitted": "2023-01-01T12:00:00.000Z",
      "lastDownloaded": "2023-01-01T12:30:00.000Z",
      "warnings": 0,
      "errors": 0,
      "isSitemapsIndex": false,
      "isPending": false,
      "contents": [
        {
          "type": "web",
          "submitted": 50,
          "indexed": 48
        }
      ]
    }
  ]
}
```

Error:

```json
{
  "success": false,
  "error": "Service account does not have access to this site"
}
```

## Notes

- The function will automatically try different site URL formats to find one that works
- If no sitemaps are found for the site, the `sitemaps` array will be empty