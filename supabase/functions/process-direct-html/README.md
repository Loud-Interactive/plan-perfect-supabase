# process-direct-html Edge Function

This Edge Function analyzes HTML content directly for SEO optimization without requiring scraping. It provides comprehensive analysis of content against a target keyword.

## Features

- Extract meaningful content from HTML
- Calculate keyword density and usage
- Analyze heading structure and keyword placement
- Identify top keywords and relevant phrases
- Generate overall SEO score
- Provide actionable recommendations for improvement

## API Usage

### Request

```json
{
  "html": "<html>...</html>",
  "targetKeyword": "your target keyword",
  "url": "https://example.com/page" // optional
}
```

### Response

```json
{
  "success": true,
  "analysis": {
    "extractedText": "...",
    "wordCount": 1250,
    "targetKeyword": "your target keyword",
    "keywordCount": 12,
    "keywordDensity": "0.96%",
    "headings": ["h1: Page Title", "h2: Section Title", ...],
    "headingScore": 85,
    "keywords": [
      {
        "term": "keyword",
        "count": 15,
        "density": "1.2%",
        "relevance": 100
      },
      ...
    ],
    "overallScore": 78,
    "recommendations": [
      "Include your target keyword in the H1 heading.",
      ...
    ]
  }
}
```

## Error Response

```json
{
  "success": false,
  "error": "Error message..."
}
```

## Implementation Details

### Content Extraction

The function uses a two-tier approach for extracting content:
1. First attempts to use article-extractor to identify main content
2. Falls back to cheerio-based extraction if article extraction fails

### Scoring Algorithm

The overall score is calculated as a weighted average of:
- Heading score (40%): Based on keyword usage in headings and structure
- Density score (30%): Optimal density is 0.5-3%
- Text length score (30%): Favors content with 700+ words

### Keyword Analysis

The function analyzes:
- Single words
- 2-word phrases (bigrams)
- 3-word phrases (trigrams)

It calculates relevance scores based on:
- Exact matches with target keyword
- Partial matches
- Frequency of occurrence

## Example Usage from Browser

```javascript
async function analyzeHtml() {
  const html = document.getElementById('htmlContent').value;
  const targetKeyword = document.getElementById('targetKeyword').value;
  
  const response = await fetch('https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/process-direct-html', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      html,
      targetKeyword,
      url: 'https://example.com'
    })
  });
  
  const result = await response.json();
  console.log(result);
}
```

## Deployment

```bash
supabase functions deploy process-direct-html --no-verify-jwt
```