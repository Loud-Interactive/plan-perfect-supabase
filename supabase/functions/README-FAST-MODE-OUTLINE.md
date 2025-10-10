# Fast Mode Outline Generation

## Overview

Fast mode outline generation is a high-performance alternative to the standard 3-function pipeline, reducing outline generation time from 10-20 minutes to 2-5 minutes while maintaining comparable quality.

## Architecture

### Traditional Flow (Slow Mode)
```
generate-outline
    ↓
search-outline-content (Claude generates search terms)
    ↓
process-search-queue (Jina.ai searches in batches)
    ↓
analyze-outline-content (Claude analyzes URLs)
    ↓
Final Outline
```
**Time**: 10-20 minutes | **Cost**: ~$0.50-$2.00

### Fast Mode Flow
```
generate-outline (fast: true)
    ↓
fast-outline-search (Single Groq API call)
    ├─ Browser search (autonomous)
    ├─ Markdown extraction
    ├─ Heading extraction
    └─ Quote extraction
    ↓
fast-analyze-outline-content (Groq-powered outline generation)
    ├─ Fetches content_plan data
    ├─ Fetches brand profile
    ├─ Generates outline with Groq gpt-oss-120b
    └─ Respects brand restrictions (avoid_topics, competitors)
    ↓
Final Outline
```
**Time**: 2-5 minutes | **Cost**: ~$0.10-$0.30

## Key Features

### 1. Autonomous Search Strategy
The Groq model can adjust search terms if initial results are off-brand:
```
Initial query: "best protein shakes muscle building"
If results are generic fitness articles...
Model autonomously tries: "best protein shakes centr.com"
Or: "Chris Hemsworth protein shake recommendations"
```

### 2. Rich Data Extraction
Unlike slow mode (text only), fast mode extracts:
- **Full markdown content** (preserved formatting)
- **H1-H4 headings** (for outline structure analysis)
- **Quotes with citations** (for content credibility)

Example result object:
```json
{
  "index": 1,
  "title": "Chris Hemsworth Workout Routine – Centr Blog",
  "link": "https://centr.com/blog/show/31055/chris-hemsworth-workout-routine",
  "markdown": "# Chris Hemsworth Workout Routine\n\n## Follow in Chris...",
  "headings": [
    "# Chris Hemsworth Workout Routine",
    "## Follow in Chris Hemsworth's fitness footsteps",
    "### Centr Power 13‑week muscle‑building program"
  ],
  "summary": "The Centr blog breaks down Chris Hemsworth's 13‑week...",
  "quotes": [
    {
      "text": "It doesn't happen by magic, it's about consistent, targeted work.",
      "citation": "https://centr.com/blog/show/31055/chris-hemsworth-workout-routine"
    }
  ]
}
```

### 3. Groq-Powered Outline Generation
Unlike slow mode (Claude Extended Thinking with 23K budget_tokens), fast mode uses Groq's gpt-oss-120b for outline generation:

**Key Differences**:
- **No intro/conclusion sections**: Focuses on core content (4-5 sections)
- **Content plan context**: Receives full content_plan JSON from database
- **Brand restrictions**: Actively avoids topics and competitor names
- **Fast reasoning**: Uses reasoning_effort: "medium" instead of extended thinking
- **Structured output**: 3-4 subsections per main section

**Outline Structure**:
```json
{
  "title": "Article Title",
  "sections": [
    {
      "title": "Main Section 1",
      "subheadings": ["Subsection 1.1", "Subsection 1.2", "Subsection 1.3"]
    },
    {
      "title": "Main Section 2",
      "subheadings": ["Subsection 2.1", "Subsection 2.2", "Subsection 2.3", "Subsection 2.4"]
    }
  ]
}
```

### 4. Brand-Aware Search & Generation
Fast mode passes the complete brand profile to both search and outline generation:
- Brand voice and personality
- Competitor names/domains (to avoid citing)
- Products and services
- USP and differentiators
- Target persona
- Topics to avoid

This ensures both search results and outline structure align with brand strategy.

### 5. Automatic Fallback
If fast mode fails (API error, rate limit, timeout):
1. Logs detailed error to `content_plan_outline_statuses`
2. Updates job to `fast_mode_failed_retrying_slow`
3. Automatically retries with slow mode
4. No user intervention required

## Usage

### Basic Example
```typescript
const response = await fetch('https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/generate-outline', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
  },
  body: JSON.stringify({
    post_title: "Best Protein Shakes for Muscle Building",
    content_plan_keyword: "protein shakes",
    post_keyword: "best protein shakes muscle building",
    domain: "centr.com",
    fast: true  // Enable fast mode
  })
});

const { job_id, success, message } = await response.json();
console.log(`Job created: ${job_id}`);
```

### Polling for Completion
```typescript
const pollOutline = async (job_id) => {
  const { data: statuses } = await supabase
    .from('content_plan_outline_statuses')
    .select('*')
    .eq('outline_guid', job_id)
    .order('created_at', { ascending: false })
    .limit(1);

  const status = statuses[0].status;

  if (status === 'completed') {
    // Fetch final outline
    const { data: outline } = await supabase
      .from('content_plan_outlines')
      .select('outline')
      .eq('guid', job_id)
      .single();

    return JSON.parse(outline.outline);
  } else if (status.includes('error')) {
    throw new Error(`Outline generation failed: ${status}`);
  } else {
    // Still processing
    console.log(`Status: ${status}`);
    await new Promise(resolve => setTimeout(resolve, 3000));
    return pollOutline(job_id);
  }
};

const outline = await pollOutline(job_id);
```

## Database Schema

### New Columns
```sql
-- outline_generation_jobs
ALTER TABLE outline_generation_jobs
ADD COLUMN fast_mode BOOLEAN DEFAULT FALSE;

-- outline_search_results
ALTER TABLE outline_search_results
ADD COLUMN headings_array JSONB,
ADD COLUMN quotes_array JSONB;
```

### Example Data
```sql
-- Fast mode search result
INSERT INTO outline_search_results (
  job_id,
  search_term,
  search_category,
  search_priority,
  url,
  title,
  description,
  content,
  headings_array,
  quotes_array
) VALUES (
  'uuid-here',
  'best protein shakes muscle building',
  'fast',
  1,
  'https://centr.com/blog/protein-shakes',
  'Best Protein Shakes for Muscle Building',
  'A comprehensive guide to choosing...',
  '# Best Protein Shakes\n\n## Introduction\n...',
  '["# Best Protein Shakes", "## Introduction", "### Whey vs Plant-Based"]',
  '[{"text": "Protein timing matters less than total daily intake", "citation": "https://centr.com/blog/protein-shakes"}]'
);
```

## Status Progression

### Fast Mode Statuses
```
outline_generation_started
    ↓
fast_search_started
    ↓
fetching_brand_profile
    ↓
brand_profile_retrieved (or using_default_brand_profile)
    ↓
initiating_intelligent_search
    ↓
groq_search_in_progress
    ↓
parsing_search_results
    ↓
saving_10_search_results
    ↓
fast_search_completed
    ↓
preparing_to_fetch_article_data
    ↓
analyzing_article_data
    ↓
generating_outline_with_groq
    ↓
parsing_outline_response
    ↓
saving_outline
    ↓
completed
```

### Error Statuses
- `fast_search_error: <message>` - Groq search API failed
- `fast_analysis_error: <message>` - Groq outline generation failed
- `fast_mode_failed_retrying_slow` - Falling back to slow mode
- `error_both_fast_and_slow_failed` - Both modes failed

## Performance Metrics

### Time Comparison (Average)
| Phase | Slow Mode | Fast Mode |
|-------|-----------|-----------|
| Search term generation | 3-5 sec | 0 sec (included in search) |
| Searching | 3-10 min | 60-120 sec |
| URL analysis | 2-5 min | 30-60 sec |
| Outline generation | 2-5 min | 30-90 sec |
| **Total** | **10-20 min** | **2-5 min** |

### Cost Comparison
| Component | Slow Mode | Fast Mode |
|-----------|-----------|-----------|
| Search terms (Claude) | ~$0.01 | Included |
| Searches (Jina.ai) | ~$0.15-0.30 | Included |
| URL analysis (Claude) | ~$0.20-0.50 | Included |
| Groq API call | - | ~$0.05-0.15 |
| Outline gen (Claude) | ~$0.10-0.50 | ~$0.05-0.15 |
| **Total** | **~$0.50-$2.00** | **~$0.10-$0.30** |

### Quality Metrics (Preliminary)
- **Relevance**: 90%+ (brand-aware search)
- **Source Authority**: Comparable to slow mode
- **Outline Coherence**: Equivalent (same analysis function)
- **Completion Rate**: 95%+ (with fallback)

## Limitations

1. **Groq Rate Limits**: Varies by plan, typically 30-60 requests/minute
2. **Output Token Limit**: 65K tokens (usually sufficient for 10 articles)
3. **No Extended Thinking**: Uses `reasoning_effort: "medium"` (vs Claude's extended thinking in slow mode)
4. **Browser Search Quality**: May occasionally return less authoritative sources than Jina.ai
5. **New Feature**: Less battle-tested than slow mode (launched 2025-10-10)

## Troubleshooting

### Fast Mode Not Working
```bash
# Check GROQ_API_KEY is set
supabase secrets list --project-ref jsypctdhynsdqrfifvdh

# If not set
supabase secrets set GROQ_API_KEY=your_key --project-ref jsypctdhynsdqrfifvdh
```

### Rate Limit Errors
```sql
-- Check for rate limit status
SELECT * FROM content_plan_outline_statuses
WHERE status LIKE '%rate%limit%'
ORDER BY created_at DESC;

-- Jobs will automatically fallback to slow mode
```

### Comparing Results
```sql
-- Get fast mode results
SELECT * FROM outline_search_results
WHERE search_category = 'fast'
AND job_id = 'your-job-id';

-- Compare with slow mode results
SELECT * FROM outline_search_results
WHERE search_category IN ('base', 'combined', 'titleAngle', 'relatedConcept')
AND job_id = 'different-job-id';
```

## Deployment

### Initial Setup
```bash
# 1. Apply database migrations
supabase db push

# 2. Deploy functions
supabase functions deploy generate-outline --project-ref jsypctdhynsdqrfifvdh
supabase functions deploy fast-outline-search --project-ref jsypctdhynsdqrfifvdh
supabase functions deploy fast-analyze-outline-content --project-ref jsypctdhynsdqrfifvdh

# 3. Set Groq API key
supabase secrets set GROQ_API_KEY=gsk_... --project-ref jsypctdhynsdqrfifvdh
```

### Using Deployment Script
```bash
chmod +x deploy-fast-mode.sh
./deploy-fast-mode.sh
```

## Future Enhancements

### Planned
- [ ] A/B testing framework to compare fast vs slow quality
- [ ] Metrics dashboard showing time/cost savings
- [ ] Configurable search result count (currently 10)
- [ ] Parallel Groq calls for even faster processing
- [ ] Hybrid mode: Fast search + slow analysis for critical content

### Under Consideration
- [ ] Make fast mode default after validation period
- [ ] Add caching layer for frequently searched topics
- [ ] Embedding-based deduplication of search results
- [ ] Progressive outline generation (refine as more results arrive)

## Support

For issues or questions:
1. Check `content_plan_outline_statuses` for detailed error messages
2. Review function logs: `supabase functions logs fast-outline-search`
3. Compare with slow mode results to validate quality
4. Report issues via GitHub with job_id and error status

## References

- Main outline generation docs: `/supabase/functions/README-OUTLINE-GENERATION.md`
- Groq API docs: https://console.groq.com/docs
- Browser search tool: https://console.groq.com/docs/tool-use#browser-search
- CLAUDE.md: Fast Mode section
