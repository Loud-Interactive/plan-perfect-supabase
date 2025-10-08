# AI Style Guide Functions Deployment Guide

This guide explains how to deploy and use the AI style guide generation system, which consists of three edge functions:

1. `fetch-markdown-content`: Fetches blog post content and converts it to markdown
2. `generate-ai-style-guide`: Analyzes blog posts with Claude AI to generate a style guide
3. `save-ai-style-guide`: Saves the generated style guide to the preferencesPerfect API

## Prerequisites

- Supabase CLI installed
- Access to the Supabase project
- Anthropic API key for Claude AI

## Environment Variables

Ensure these environment variables are set in your Supabase project:

```bash
# Required for all functions
supabase secrets set SUPABASE_URL=<your-supabase-url>
supabase secrets set SUPABASE_ANON_KEY=<your-supabase-anon-key>

# Required for generate-ai-style-guide
supabase secrets set ANTHROPIC_API_KEY=<your-anthropic-api-key>
```

## Deployment

Deploy the functions in the following order:

```bash
# 1. Deploy the markdown content fetcher
supabase functions deploy fetch-markdown-content

# 2. Deploy the style guide saver
supabase functions deploy save-ai-style-guide

# 3. Deploy the main style guide generator
supabase functions deploy generate-ai-style-guide
```

## Usage

### Generate a Style Guide

To generate a style guide for a domain, make a POST request to the function endpoint:

```bash
curl -X POST "https://<your-project-id>.supabase.co/functions/v1/generate-ai-style-guide" \
-H "Authorization: Bearer <your-supabase-anon-key>" \
-H "Content-Type: application/json" \
-d '{
  "domain": "example.com",
  "urls": [
    "https://example.com/blog/post1",
    "https://example.com/blog/post2",
    "https://example.com/blog/post3"
  ],
  "save": true
}'
```

Parameters:
- `domain`: The website domain for the style guide (required)
- `urls`: Array of blog post URLs to analyze (1-3 URLs, required)
- `save`: Boolean indicating whether to save the result to preferencesPerfect (optional, defaults to true)

### Retrieve a Style Guide

To retrieve an existing style guide:

```bash
curl -X POST "https://<your-project-id>.supabase.co/functions/v1/get-ai-style-guide" \
-H "Authorization: Bearer <your-supabase-anon-key>" \
-H "Content-Type: application/json" \
-d '{
  "domain": "example.com"
}'
```

## Workbright.com Example

To generate a style guide for workbright.com using the specified blog posts:

```bash
curl -X POST "https://mqjjmgnzofxwcchsivov.supabase.co/functions/v1/generate-ai-style-guide" \
-H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1xampuZ256b2Z4d2NjaHNpdm92Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MDg2MDUwMTUsImV4cCI6MjAyNDE4MTAxNX0.1SmWZvlSLGBNRoeReglMoNwPb4D--8fUSgL3K3U6rU0" \
-H "Content-Type: application/json" \
-d '{
  "domain": "workbright.com",
  "urls": [
    "https://workbright.com/blog/e-verify-compliance-2025/",
    "https://workbright.com/blog/the-future-of-compliance/", 
    "https://workbright.com/blog/how-technology-fuels-onboarding-success/"
  ],
  "save": true
}'
```

## Testing with Node.js

A Node.js script is provided to test the style guide generation for workbright.com:

```
node test-style-guide.js
```

This script deploys the functions (if needed) and then generates a style guide for workbright.com using the specified blog posts. The result is saved to `workbright_style_guide.json`.

## Implementation Details

1. **Fetch Markdown Content**: Uses the Markdowner API to convert blog post content to markdown
2. **Generate AI Style Guide**: Analyzes content with Claude 3.7 Sonnet to create a comprehensive style guide
3. **Save AI Style Guide**: Saves the style guide to preferencesPerfect for later retrieval

The style guide includes analysis of tone, voice, sentence structure, formatting preferences, and other stylistic elements that define the website's content.