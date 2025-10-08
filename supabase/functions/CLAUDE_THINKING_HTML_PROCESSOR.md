# HTML Processor with Claude 3.7 Thinking Integration

This document provides an overview of the enhanced HTML content analysis system implemented with Claude 3.7 Sonnet and its thinking feature.

## Edge Functions

We have implemented several Edge Functions for HTML processing:

1. **process-direct-html-llm-thinking**: Primary implementation with Claude 3.7 thinking capability
2. **process-direct-html-llm-fixed**: Fixed version that resolved deployment issues
3. **process-direct-html-llm**: Standard implementation without thinking
4. **process-direct-html**: Original implementation without LLM

## Key Features

- HTML content extraction using Cheerio
- Analysis with Claude 3.7 Sonnet + thinking capability
- SEO and content quality assessment
- Database integration for analysis storage
- Configurable thinking budget (default: 16,000 tokens)
- HTML extraction fallback mechanisms for reliable content extraction

## Deployment

To deploy the functions:

```bash
cd supabase/functions
supabase functions deploy process-direct-html-llm-thinking --no-verify-jwt
supabase functions deploy process-direct-html-llm-fixed --no-verify-jwt
```

### Environment Variables

Required environment variables:
- `ANTHROPIC_API_KEY`: Your Anthropic API key
- `SUPABASE_URL`: Your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY`: Your Supabase service role key

Set them using:

```bash
supabase secrets set ANTHROPIC_API_KEY=your-anthropic-api-key
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

## Database Schema

The system uses a `content_analysis` table with the following structure:

```sql
CREATE TABLE IF NOT EXISTS content_analysis (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id TEXT NOT NULL,
  project_id TEXT,
  url TEXT NOT NULL,
  target_keyword TEXT NOT NULL,
  html_content TEXT NOT NULL,
  extracted_text TEXT,
  analysis_result JSONB NOT NULL,
  word_count INT NOT NULL,
  keyword_density NUMERIC(5,2),
  overall_score INT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
  deleted_at TIMESTAMP WITH TIME ZONE,
  llm_model_version TEXT,
  processing_time_ms INT,
  content_quality_score INT,
  thinking_logs TEXT
);
```

## API Usage

### Request Format

```json
{
  "html": "<html content>",
  "targetKeyword": "target keyword",
  "url": "https://example.com/page", // Optional
  "saveToDatabase": true, // Optional, default false
  "clientId": "client-id", // Required if saveToDatabase=true
  "projectId": "project-id", // Optional
  "modelVersion": "claude-3-7-sonnet-20250219", // Optional, default "claude-3-7-sonnet-20250219"
  "enableThinking": true, // Optional, default true
  "thinkingBudget": 16000 // Optional, default 16000
}
```

### Response Format

```json
{
  "success": true,
  "analysis": {
    // Analysis results in the format specified in the prompt
    "extractedText": "...",
    "wordCount": 1234,
    "targetKeyword": "...",
    "keywordCount": 12,
    "keywordDensity": "1.2%",
    "headingScore": 85,
    "headings": ["h1: ...", "h2: ..."],
    "keywords": [
      { "term": "...", "count": 12, "density": "1.2%", "relevance": 85 }
    ],
    "overallScore": 78,
    "recommendations": ["..."],
    "contentQualityAnalysis": {
      "relevance": 80,
      "depth": 75,
      "readability": 85,
      "comprehensiveness": 70
    },
    "semanticAnalysis": {
      "topicCoverage": 75,
      "relatedTopicsMissing": ["..."],
      "relatedTopicsCovered": ["..."]
    },
    "keywordPositioning": {
      "inTitle": true,
      "inFirstParagraph": true,
      "inLastParagraph": false,
      "inURLSlug": true,
      "inHeadings": 3
    },
    "thinking": "Claude's thinking process...", // Only if enableThinking=true
    "processingMetadata": {
      "processingTimeMs": 1234,
      "modelVersion": "claude-3-7-sonnet-20250219",
      "enabledThinking": true,
      "thinkingBudget": 16000,
      "analyzedAt": "2025-05-05T12:34:56.789Z"
    }
  },
  "thinkingEnabled": true,
  "processingTimeMs": 1234,
  "databaseSave": {
    "success": true,
    "id": "uuid",
    "table": "content_analysis"
  }
}
```

## HTML Frontend

A frontend interface is available at `/supabase/functions/bulk-html-processor-with-storage.html` that allows for testing and visualizing results. The interface has been enhanced to support Claude analysis and database storage.

## Implementation Details

### Content Extraction

The HTML processor uses Cheerio to extract content from HTML documents. The extraction process follows these steps:

1. Remove unwanted elements (scripts, styles, iframes, etc.)
2. Try to find main content using common selectors (main, article, .content, etc.)
3. Fall back to body text if no main content is found
4. Extract and format headings for additional context
5. Clean and normalize the extracted text

### LLM Analysis with Thinking

The Claude 3.7 Sonnet analysis with thinking feature provides:

1. Deep analysis of content structure and flow
2. Detailed assessment of keyword usage patterns 
3. Evaluation of semantic fields and topic coverage
4. Consideration of industry best practices
5. Analysis of potential gaps in keyword coverage

The thinking feature exposes Claude's reasoning process, making the analysis more transparent and allowing for better understanding of the results.

### JSON Extraction and Parsing

The processor implements robust JSON extraction from Claude's response:

1. Try to find JSON within code blocks (```json ... ```)
2. Fall back to direct extraction of JSON-like structures
3. Parse the JSON and add thinking logs if available
4. Handle parsing errors gracefully

## Troubleshooting

If you encounter deployment errors related to missing modules, check that all imports are correctly specified and available in the Deno runtime. The implementation now uses Cheerio for HTML parsing instead of the problematic article_extractor module.

Common issues:

1. **ANTHROPIC_API_KEY not set**: Make sure to set the environment variable
2. **Database save failures**: Check Supabase URL and service role key
3. **CORS issues**: The Edge Function includes CORS headers for cross-origin requests
4. **Large HTML content**: The processor automatically truncates very large content
5. **JSON parsing errors**: The processor includes fallback mechanisms for JSON extraction

## Migration from Previous Version

If you were using the previous `process-direct-html` Edge Function, here are the key differences:

1. Uses Claude 3.7 Sonnet for LLM-based analysis instead of rule-based analysis
2. Supports thinking capability for transparent reasoning
3. Provides more comprehensive SEO and content quality metrics
4. Enhanced database schema for storing analysis results
5. More robust HTML extraction with fallback mechanisms
6. Configurable model version and thinking budget