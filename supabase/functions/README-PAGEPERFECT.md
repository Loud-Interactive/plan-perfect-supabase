# PagePerfect Implementation

PagePerfect is an advanced content optimization system built on Supabase that automatically identifies SEO opportunities and generates high-quality content rewrites. It uses vector embeddings, clustering, and AI-powered content generation to dramatically improve search visibility.

## System Components

1. **Database Schema**
   - Robust PostgreSQL tables with pgvector extension
   - Partitioned tables for efficient GSC data storage
   - Optimized indexes for performance

2. **Edge Functions**
   - `crawl-page-html`: Fetches and extracts HTML content from URLs
   - `ingest-gsc`: Pulls keyword data from Google Search Console API
   - `segment-and-embed-page`: Segments content and creates OpenAI embeddings
   - `keyword-clustering`: Groups keywords by semantic similarity using DBSCAN
   - `content-gap-analysis`: Identifies content gaps based on keyword clusters
   - `generate-rewrite-draft`: Creates AI-powered content rewrites
   - `export-all-rankings`: Exports all GSC data for analysis

3. **Data Processing Pipeline**
   - HTML crawling and content extraction
   - GSC data ingestion and processing
   - Vector embedding generation
   - Clustering and semantic analysis
   - Content gap identification
   - AI-powered rewrite generation

## Core Algorithms

### Keyword Opportunity Formula

The system uses a sophisticated formula to score keyword opportunities:

```
OpportunityScore = 0.7 * PositionScore + 0.3 * ImpressionScore

Where:
- PositionScore = 1 / (1 + e^(0.5 * (position - 10)))
- ImpressionScore = log10(impressions + 1) / 10
```

This creates a balanced scoring system that prioritizes:
- Keywords with good visibility potential (positions 5-15)
- Keywords with meaningful traffic volume
- Quick wins that can drive immediate results

### Content Gap Analysis

The system identifies content gaps through vector similarity analysis:

1. Generate embeddings for keyword clusters (grouped by semantic similarity)
2. Generate embeddings for content paragraphs
3. Calculate cosine similarity between each cluster and paragraph
4. Identify clusters with low maximum similarity scores (below threshold)
5. Calculate opportunity scores for each gap
6. Prioritize rewrites based on opportunity score

## Deployment

To deploy the PagePerfect edge functions, run:

```bash
./deploy-pageperfect-functions.sh
```

This will deploy all edge functions with appropriate JWT verification settings.

## Usage Example

```typescript
// Example: Analyze content gaps for a page
const response = await fetch('/functions/v1/content-gap-analysis', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${supabaseAccessToken}`
  },
  body: JSON.stringify({
    pageId: '12345',
    similarityThreshold: 0.65
  })
});

const result = await response.json();
console.log(`Found ${result.gapCount} content gaps`);

// Process gaps and generate rewrites for top opportunities
for (const gap of result.gapAnalysis.slice(0, 3)) {
  if (gap.hasContentGap && gap.opportunityScore > 50) {
    await fetch('/functions/v1/generate-rewrite-draft', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseAccessToken}`
      },
      body: JSON.stringify({
        pageId: '12345',
        clusterId: gap.clusterId
      })
    });
  }
}
```

## Next Steps

1. **Implement Cron Jobs**
   - Daily GSC data ingest
   - Hourly processing of new URLs
   - Weekly re-calibration of CTR curve

2. **Build Approval Interface**
   - Create diff presentation component
   - Implement approval workflow
   - Connect with CMS webhook for publishing

3. **Optimize Performance**
   - Monitor database query performance
   - Implement batch processing for large sites
   - Optimize vector search with HNSW index

## Dependencies

- Supabase with pgvector extension
- OpenAI API (embeddings and content generation)
- Google Search Console API (keyword data)
- Cheerio (HTML parsing)
- diff (content diff generation)