# Google Search Console API Integration

This document provides documentation for the Google Search Console (GSC) API integration functions. These functions allow you to programmatically interact with Google Search Console to request indexing, check indexation status, and retrieve sitemaps.

## Table of Contents

- [Overview](#overview)
- [Authentication](#authentication)
- [API Endpoints](#api-endpoints)
  - [Request Indexing](#request-indexing)
  - [Check Indexation Status](#check-indexation-status)
  - [Get Sitemaps](#get-sitemaps)
- [Implementation Examples](#implementation-examples)
  - [cURL Examples](#curl-examples)
  - [Next.js Implementation](#nextjs-implementation)
  - [Supabase Client Implementation](#supabase-client-implementation)
- [Troubleshooting](#troubleshooting)

## Overview

These functions are implemented as Supabase Edge Functions and provide the following capabilities:

1. **Request Indexing**: Submit URLs to Google's Indexing API for faster crawling and indexing
2. **Check Indexation Status**: Verify if a URL is indexed by Google and its current status
3. **Get Sitemaps**: Retrieve all sitemaps registered with a site in Google Search Console

## Authentication

All functions require a Google Service Account with access to your Google Search Console properties. The service account credentials should be stored as an environment variable named `GSC_CREDENTIALS` in your Supabase project.

Make sure your service account:
- Has "Read & Analyze" permissions in Google Search Console
- For the Indexing API, has the "Owner" or "Full" permission level

## API Endpoints

### Request Indexing

Submits a URL to Google's Indexing API for faster crawling and indexing.

**Endpoint**: `/functions/v1/request-indexing`

**Request Body**:
```json
{
  "url": "https://example.com/my-page/",
  "siteUrl": "https://example.com/" // Optional, will be detected from URL if not provided
}
```

**Response**:
```json
{
  "success": true,
  "url": "https://example.com/my-page/",
  "siteUrl": "sc-domain:example.com",
  "result": {
    "urlNotificationMetadata": {
      "url": "https://example.com/my-page/",
      "latestUpdate": {
        "type": "URL_UPDATED",
        "notifyTime": "2023-05-06T12:34:56.789Z"
      }
    }
  }
}
```

**Rate limits**: The Indexing API has a quota of 200 URLs per day, per Search Console property.

### Check Indexation Status

Checks if a URL is indexed by Google and its current status.

**Endpoint**: `/functions/v1/check-indexation`

**Request Body**:
```json
{
  "url": "https://example.com/my-page/",
  "siteUrl": "https://example.com/" // Optional, will be detected from URL if not provided
}
```

**Response**:
```json
{
  "success": true,
  "url": "https://example.com/my-page/",
  "siteUrl": "sc-domain:example.com",
  "coverageState": "Submitted and indexed",
  "emoji": "✅",
  "status": {
    "inspectionResult": {
      "indexStatusResult": {
        "coverageState": "Submitted and indexed",
        "robotsTxtState": "ALLOWED",
        "verdict": "PASS",
        "lastCrawlTime": "2023-05-05T10:20:30Z"
      },
      "pageIndexInfo": {
        // Additional page information 
      }
    }
  }
}
```

**Coverage States and Emoji**:
- ✅ Submitted and indexed
- 😵 Duplicate without user-selected canonical
- 👀 Crawled - currently not indexed
- 👀 Discovered - currently not indexed
- 🔀 Page with redirect
- ❓ URL is unknown to Google
- 🚦 Rate limited
- 🔐 Forbidden
- ❌ Error

### Get Sitemaps

Retrieves all sitemaps registered with a site in Google Search Console.

**Endpoint**: `/functions/v1/get-sitemaps`

**Request Body**:
```json
{
  "siteUrl": "https://example.com/"
}
```

**Response**:
```json
{
  "success": true,
  "siteUrl": "sc-domain:example.com",
  "sitemapCount": 2,
  "sitemaps": [
    {
      "path": "https://example.com/sitemap.xml",
      "lastSubmitted": "2023-05-04T08:15:30Z",
      "lastDownloaded": "2023-05-04T08:20:45Z",
      "warnings": 0,
      "errors": 0,
      "isSitemapsIndex": true,
      "isPending": false,
      "contents": [
        {
          "type": "web",
          "submitted": 1000,
          "indexed": 950
        }
      ]
    },
    {
      "path": "https://example.com/post-sitemap.xml",
      "lastSubmitted": "2023-05-04T08:15:32Z",
      "lastDownloaded": "2023-05-04T08:21:00Z",
      "warnings": 0,
      "errors": 0,
      "isSitemapsIndex": false,
      "isPending": false,
      "contents": [
        {
          "type": "web",
          "submitted": 500,
          "indexed": 490
        }
      ]
    }
  ]
}
```

## Implementation Examples

### cURL Examples

**Request Indexing**:
```bash
curl -X POST 'https://yourproject.supabase.co/functions/v1/request-indexing' \
  -H 'Authorization: Bearer YOUR_SUPABASE_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://example.com/my-page/"}'
```

**Check Indexation**:
```bash
curl -X POST 'https://yourproject.supabase.co/functions/v1/check-indexation' \
  -H 'Authorization: Bearer YOUR_SUPABASE_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://example.com/my-page/"}'
```

**Get Sitemaps**:
```bash
curl -X POST 'https://yourproject.supabase.co/functions/v1/get-sitemaps' \
  -H 'Authorization: Bearer YOUR_SUPABASE_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"siteUrl": "https://example.com/"}'
```

### Next.js Implementation

Here's a simple Next.js component that demonstrates how to use these APIs:

```jsx
import { useState } from 'react';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

export default function GSCTools() {
  const [url, setUrl] = useState('');
  const [siteUrl, setSiteUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const requestIndexing = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('request-indexing', {
        body: { url, siteUrl: siteUrl || undefined },
      });
      
      if (error) throw error;
      setResult(data);
    } catch (error) {
      console.error('Error requesting indexing:', error);
      setResult({ error: error.message });
    } finally {
      setLoading(false);
    }
  };

  const checkIndexation = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('check-indexation', {
        body: { url, siteUrl: siteUrl || undefined },
      });
      
      if (error) throw error;
      setResult(data);
    } catch (error) {
      console.error('Error checking indexation:', error);
      setResult({ error: error.message });
    } finally {
      setLoading(false);
    }
  };

  const getSitemaps = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('get-sitemaps', {
        body: { siteUrl: siteUrl || url },
      });
      
      if (error) throw error;
      setResult(data);
    } catch (error) {
      console.error('Error getting sitemaps:', error);
      setResult({ error: error.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Google Search Console Tools</h1>
      
      <div className="mb-4">
        <input
          type="text"
          placeholder="URL (e.g., https://example.com/page/)"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="w-full p-2 border rounded mb-2"
        />
        
        <input
          type="text"
          placeholder="Site URL (optional, e.g., https://example.com/)"
          value={siteUrl}
          onChange={(e) => setSiteUrl(e.target.value)}
          className="w-full p-2 border rounded mb-2"
        />
        
        <div className="flex space-x-2">
          <button
            onClick={requestIndexing}
            disabled={loading || !url}
            className="bg-blue-500 text-white px-4 py-2 rounded disabled:opacity-50"
          >
            Request Indexing
          </button>
          
          <button
            onClick={checkIndexation}
            disabled={loading || !url}
            className="bg-green-500 text-white px-4 py-2 rounded disabled:opacity-50"
          >
            Check Indexation
          </button>
          
          <button
            onClick={getSitemaps}
            disabled={loading || (!url && !siteUrl)}
            className="bg-purple-500 text-white px-4 py-2 rounded disabled:opacity-50"
          >
            Get Sitemaps
          </button>
        </div>
      </div>
      
      {loading && <p>Loading...</p>}
      
      {result && (
        <div className="mt-4">
          <h2 className="text-xl font-semibold mb-2">Result:</h2>
          <pre className="bg-gray-100 p-4 rounded overflow-auto max-h-96">
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
```

### Supabase Client Implementation

Here's a utility class for working with the GSC API functions through Supabase:

```javascript
// gsc-api.js
import { createClient } from '@supabase/supabase-js';

export class GSCApi {
  constructor(supabaseUrl, supabaseKey) {
    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  /**
   * Request indexing for a URL
   * @param {string} url - The URL to request indexing for
   * @param {string} [siteUrl] - Optional site URL (will be detected from URL if not provided)
   * @returns {Promise<object>} - The result of the indexing request
   */
  async requestIndexing(url, siteUrl = undefined) {
    const { data, error } = await this.supabase.functions.invoke('request-indexing', {
      body: { url, siteUrl },
    });
    
    if (error) {
      throw new Error(`Error requesting indexing: ${error.message}`);
    }
    
    return data;
  }

  /**
   * Check indexation status of a URL
   * @param {string} url - The URL to check
   * @param {string} [siteUrl] - Optional site URL (will be detected from URL if not provided)
   * @returns {Promise<object>} - The indexation status
   */
  async checkIndexation(url, siteUrl = undefined) {
    const { data, error } = await this.supabase.functions.invoke('check-indexation', {
      body: { url, siteUrl },
    });
    
    if (error) {
      throw new Error(`Error checking indexation: ${error.message}`);
    }
    
    return data;
  }

  /**
   * Get sitemaps for a site
   * @param {string} siteUrl - The site URL
   * @returns {Promise<object>} - The sitemaps information
   */
  async getSitemaps(siteUrl) {
    const { data, error } = await this.supabase.functions.invoke('get-sitemaps', {
      body: { siteUrl },
    });
    
    if (error) {
      throw new Error(`Error getting sitemaps: ${error.message}`);
    }
    
    return data;
  }
}

// Usage example:
// const gscApi = new GSCApi(
//   process.env.NEXT_PUBLIC_SUPABASE_URL,
//   process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
// );
// 
// // Request indexing
// const indexingResult = await gscApi.requestIndexing('https://example.com/my-page/');
// 
// // Check indexation
// const indexationStatus = await gscApi.checkIndexation('https://example.com/my-page/');
// 
// // Get sitemaps
// const sitemaps = await gscApi.getSitemaps('https://example.com/');
```

## Troubleshooting

### Common Issues

1. **Service account does not have access to this site**
   - Ensure your service account has been added to GSC with appropriate permissions
   - Verify the site URL format matches exactly what's in GSC (may need to use sc-domain: format)

2. **Rate limit exceeded**
   - The Indexing API has a quota of 200 URLs per day, per Search Console property
   - The URL Inspection API has stricter limits; spread requests over time

3. **Authentication errors**
   - Check that GSC_CREDENTIALS environment variable is properly set
   - Ensure the service account credentials are valid and have not expired

4. **URL format issues**
   - Try different URL formats: with/without www, http/https, or sc-domain: format
   - The API will attempt to find the correct format, but providing the exact format helps

If problems persist, check the function logs in Supabase for more detailed error messages.