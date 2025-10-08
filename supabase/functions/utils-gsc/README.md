# GSC Utilities

This module provides shared utility functions for working with the Google Search Console API.

## Features

- Authentication with Google OAuth 2.0 using service account credentials
- Site URL formatting and validation
- URL parsing utilities
- Common error handling patterns

## Configuration

These utilities use a shared Google Search Console authentication setup via the `GSC_CREDENTIALS` environment variable, which should contain a JSON string with the following structure:

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

## Usage

This utility module is designed to be imported by other edge functions:

```typescript
import { getGSCAccessToken, checkSiteUrl, extractDomain, corsHeaders } from '../utils-gsc/index.ts';
```

### Key Functions

#### `getGSCAccessToken(): Promise<string>`

Generates and returns an OAuth 2.0 access token for the Google Search Console API using the service account credentials.

#### `getSiteUrlList(accessToken: string): Promise<string[]>`

Returns a list of all site URLs the service account has access to in Google Search Console.

#### `checkSiteUrl(accessToken: string, siteUrl: string): Promise<string>`

Checks if the given site URL is accessible and returns a properly formatted site URL that GSC accepts.

#### `extractDomain(url: string): string`

Extracts the domain from a URL.

#### `extractPath(url: string): string` 

Extracts the path component from a URL.

### Common Headers

The module also provides standard CORS headers for API responses:

```typescript
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
```