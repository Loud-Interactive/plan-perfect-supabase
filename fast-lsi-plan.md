# Fast-LSI Implementation Plan

## 🎯 Overview

Implementation strategy for adding LSI (Latent Semantic Indexing) keyword expansion to the fast-outline edge functions, based on the Python `content_v6/research.py` implementation.

**Goal**: 4x richer content material by researching 2-3 semantically related keywords in addition to the primary keyword.

---

## 📊 Current Flow vs. Proposed Flow

### Current Flow (Single Keyword)

```
fast-outline-search
  ├─ Research primary keyword (browser_search)
  ├─ Get 10 results
  └─ Save to outline_search_results

fast-analyze-outline-content
  ├─ Read 10 results from outline_search_results
  ├─ Generate outline with 10 results
  └─ Save outline
```

**Total Research**: 10 results

---

### Proposed Flow (LSI Enhanced)

```
fast-outline-search
  ├─ Research primary keyword (browser_search)
  ├─ Get 10 results
  └─ Save to outline_search_results

fast-lsi-extract-and-research [NEW or integrated]
  ├─ Read primary results from outline_search_results
  ├─ Extract titles & headings from primary results
  ├─ Call Groq to extract 2-3 LSI keywords
  ├─ Research each LSI keyword in parallel (browser_search)
  ├─ Get 10 results per LSI keyword (20-30 more results)
  └─ Save LSI results to outline_search_results

fast-analyze-outline-content
  ├─ Read ALL results (primary + LSI) from outline_search_results
  ├─ Generate outline with 30-40 results
  └─ Save outline
```

**Total Research**: 30-40 results (4x improvement!)

---

## 🏗️ Architecture Options

### Option A: Integrated into `fast-outline-search` ⚠️

**Pros**:
- Single function call
- No additional orchestration needed

**Cons**:
- ❌ Significantly increases execution time (4x research calls)
- ❌ May hit edge function timeout limits
- ❌ Harder to debug and monitor
- ❌ All-or-nothing (if LSI fails, entire function fails)

**Verdict**: ❌ **NOT RECOMMENDED** - Too risky for timeouts

---

### Option B: New Function `fast-lsi-extract-and-research` ✅

**Pros**:
- ✅ Modular and testable
- ✅ Can be called optionally (graceful degradation)
- ✅ Separate timeout budget
- ✅ Easy to monitor and debug
- ✅ Can be skipped if time is critical

**Cons**:
- Requires additional orchestration
- Extra database calls

**Verdict**: ✅ **RECOMMENDED** - Best balance of reliability and functionality

---

### Option C: Integrated into `fast-analyze-outline-content` ⚠️

**Pros**:
- No new function needed
- Analysis happens after all research

**Cons**:
- ❌ Analysis function becomes bloated
- ❌ Research should happen before analysis, not during
- ❌ Confusing responsibility boundaries

**Verdict**: ❌ **NOT RECOMMENDED** - Violates separation of concerns

---

## 🎨 Recommended Architecture: Option B

### New Function: `fast-lsi-extract-and-research`

**Location**: `supabase/functions/fast-lsi-extract-and-research/index.ts`

**Responsibilities**:
1. Fetch primary search results from database
2. Extract titles & headings
3. Call Groq to extract 2-3 LSI keywords
4. Research each LSI keyword in parallel
5. Save LSI results to database

**Input**:
```typescript
{
  "job_id": "uuid",
  "max_keywords": 3  // Optional, default 3
}
```

**Output**:
```typescript
{
  "success": true,
  "lsi_keywords": ["keyword1", "keyword2", "keyword3"],
  "results_count": 28,
  "message": "Successfully researched 3 LSI keywords"
}
```

---

## 📋 Implementation Details

### Phase 1: Extract LSI Keywords from Primary Results

**Function**: `extractLSIKeywords()`

```typescript
async function extractLSIKeywords(
  primaryResults: SearchResult[],
  primaryKeyword: string,
  maxKeywords: number = 3
): Promise<string[]> {
  // Step 1: Extract titles and headings from primary results
  const titles = primaryResults.slice(0, 5).map(r => r.title);
  
  const headingsFlat: string[] = [];
  for (const result of primaryResults.slice(0, 5)) {
    if (result.headings_array) {
      headingsFlat.push(...result.headings_array.slice(0, 10));
    }
  }
  const limitedHeadings = headingsFlat.slice(0, 30);

  // Step 2: Get current date
  const currentDate = new Date();
  const formattedDate = currentDate.toLocaleDateString('en-US', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });

  // Step 3: Build prompt
  const prompt = `Today's date is ${formattedDate}. Analyze these SERP results for the keyword "${primaryKeyword}":

SERP Titles:
${JSON.stringify(titles, null, 2)}

Common Headings:
${JSON.stringify(limitedHeadings, null, 2)}

Based on this SERP analysis, identify ${maxKeywords} semantically related keyword variations that:
1. Are closely related to "${primaryKeyword}" but phrase it differently
2. Represent common user search intents for this topic
3. Would provide complementary research perspectives
4. Are actual phrases users would search (not just synonyms)

Examples of good related keywords for "non emergency ambulance":
- "medical transport services"
- "non-urgent patient transfer"
- "ambulette services"

Return ONLY a JSON array of ${maxKeywords} keyword strings, no extra commentary:
["keyword 1", "keyword 2", "keyword 3"]`;

  // Step 4: Call Groq (NO TOOLS - critical!)
  const groq = new Groq({ apiKey: Deno.env.get('GROQ_API_KEY') });
  
  const response = await groq.chat.completions.create({
    model: "openai/gpt-oss-120b",
    messages: [
      {
        role: "system",
        content: "You are a keyword research assistant. Return only valid JSON arrays."
      },
      {
        role: "user",
        content: prompt
      }
    ],
    temperature: 0.7,
    max_completion_tokens: 65536,
    // NO TOOLS! Critical for avoiding empty responses
  });

  const content = response.choices[0]?.message?.content || "[]";
  
  // Step 5: Parse and validate
  let keywords: string[] = [];
  try {
    const parsed = JSON.parse(content.trim());
    if (Array.isArray(parsed)) {
      keywords = parsed.filter(k => typeof k === 'string' && k.trim().length > 0);
    }
  } catch (error) {
    console.error('Failed to parse LSI keywords:', error);
    return [];
  }

  // Step 6: Remove duplicates and primary keyword
  const related = keywords
    .map(k => k.trim())
    .filter(k => k.toLowerCase() !== primaryKeyword.toLowerCase());
  
  // Dedupe while preserving order
  const unique = Array.from(new Set(related));
  
  return unique.slice(0, maxKeywords);
}
```

---

### Phase 2: Research LSI Keywords in Parallel

**Function**: `researchLSIKeywords()`

```typescript
async function researchLSIKeywords(
  lsiKeywords: string[],
  jobId: string,
  groq: Groq,
  supabase: SupabaseClient
): Promise<number> {
  let totalResults = 0;

  // Research all LSI keywords in parallel for speed
  const researchPromises = lsiKeywords.map(async (keyword, index) => {
    console.log(`[LSI ${index + 1}/${lsiKeywords.length}] Researching: ${keyword}`);
    
    try {
      // Build search prompt (same as fast-outline-search)
      const searchPrompt = `Use web search to find the top 10 authoritative articles about "${keyword}".

Search for high-quality articles specifically about "${keyword}".

For each search result, extract and return the following in JSON format:
- index (0-9)
- title
- link (URL)
- markdown (full article content)
- headings (array of H1-H4 headings)
- summary (2-3 sentences)
- quotes (array of notable quotes with citations)

Return ONLY valid JSON in this structure:
{
  "result": [
    {
      "index": 0,
      "title": "...",
      "link": "...",
      "markdown": "...",
      "headings": ["..."],
      "summary": "...",
      "quotes": [{"text": "...", "citation": "..."}]
    }
  ]
}`;

      // Call Groq with browser_search
      const stream = await groq.chat.completions.create({
        model: "openai/gpt-oss-120b",
        messages: [
          {
            role: "system",
            content: "You have web search capabilities. Use them to find articles, then return results as valid JSON only."
          },
          {
            role: "user",
            content: searchPrompt
          }
        ],
        temperature: 0.7,
        max_completion_tokens: 65536,
        top_p: 1,
        stream: true,
        tools: [{ type: "browser_search" }]
      });

      // Collect response (same as fast-outline-search)
      let fullResponse = '';
      for await (const chunk of stream) {
        if (chunk.choices[0]?.delta?.content) {
          fullResponse += chunk.choices[0].delta.content;
        }
      }

      // Parse JSON results
      const cleanedResponse = fullResponse
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();
      
      const parsedData = JSON.parse(cleanedResponse);
      const results = parsedData.result || [];

      // Save to database with lsi_keyword marker
      const insertPromises = results.map((result: any) => {
        return supabase
          .from('outline_search_results')
          .insert({
            job_id: jobId,
            result_index: result.index,
            title: result.title,
            url: result.link,
            description: result.summary,
            content: result.markdown,
            headings_array: result.headings,
            quotes_array: result.quotes,
            lsi_keyword: keyword  // NEW: Mark as LSI result
          });
      });

      await Promise.all(insertPromises);
      
      console.log(`[LSI ${index + 1}/${lsiKeywords.length}] ✅ Found ${results.length} results for: ${keyword}`);
      return results.length;
      
    } catch (error) {
      console.error(`[LSI ${index + 1}/${lsiKeywords.length}] ❌ Failed for: ${keyword}`, error);
      return 0;
    }
  });

  // Wait for all parallel research to complete
  const resultCounts = await Promise.all(researchPromises);
  totalResults = resultCounts.reduce((sum, count) => sum + count, 0);

  return totalResults;
}
```

---

### Phase 3: Database Schema Changes

**Add `lsi_keyword` column to `outline_search_results`**:

```sql
-- Migration: add_lsi_keyword_column.sql
ALTER TABLE outline_search_results 
ADD COLUMN IF NOT EXISTS lsi_keyword TEXT;

COMMENT ON COLUMN outline_search_results.lsi_keyword IS 
  'The LSI keyword this result came from (NULL for primary keyword results)';

-- Add index for filtering
CREATE INDEX IF NOT EXISTS idx_outline_search_results_lsi_keyword 
  ON outline_search_results(job_id, lsi_keyword);
```

**Add `lsi_keywords` column to `outline_generation_jobs`**:

```sql
-- Migration: add_lsi_keywords_to_jobs.sql
ALTER TABLE outline_generation_jobs 
ADD COLUMN IF NOT EXISTS lsi_keywords TEXT[];

COMMENT ON COLUMN outline_generation_jobs.lsi_keywords IS 
  'Array of LSI keywords researched for this job';
```

---

## 🔄 Updated Workflow with LSI

### Complete Flow

```typescript
// Step 1: Generate outline (existing)
POST /fast-outline-search
{
  "job_id": "uuid"
}
// → Researches primary keyword, saves 10 results

// Step 2: Extract and research LSI keywords (NEW)
POST /fast-lsi-extract-and-research
{
  "job_id": "uuid",
  "max_keywords": 3
}
// → Extracts LSI keywords, researches them, saves 20-30 more results

// Step 3: Generate outline with ALL research (existing, no changes needed!)
POST /fast-analyze-outline-content
{
  "job_id": "uuid"
}
// → Reads ALL results (primary + LSI), generates outline
```

---

## ⚡ Performance Considerations

### Timing Estimates

| Operation | Time | Notes |
|-----------|------|-------|
| Primary keyword research | 15-30s | Already done in fast-outline-search |
| LSI extraction | 5-10s | Groq text-to-text (fast) |
| Single LSI keyword research | 15-30s | Same as primary |
| 3 LSI keywords in parallel | 15-30s | Parallel execution! |
| **Total LSI overhead** | **20-40s** | Acceptable for 4x more data |

### Edge Function Timeout Strategy

- **fast-outline-search**: 30-60s (unchanged)
- **fast-lsi-extract-and-research**: 45-60s (new, needs generous timeout)
- **fast-analyze-outline-content**: 30-45s (may increase slightly due to more data)

**Total**: 105-165s (1.75-2.75 minutes) for complete LSI-enhanced pipeline

---

## 🛡️ Error Handling & Graceful Degradation

### Critical: LSI Must Be Optional

```typescript
// If LSI extraction fails, log and continue
try {
  const lsiKeywords = await extractLSIKeywords(primaryResults, primaryKeyword);
  if (lsiKeywords.length === 0) {
    console.warn('No LSI keywords extracted, continuing with primary keyword only');
    return { success: true, lsi_keywords: [], results_count: 0 };
  }
} catch (error) {
  console.error('LSI extraction failed:', error);
  // Return success=true but empty results - pipeline continues
  return { success: true, lsi_keywords: [], results_count: 0, error: error.message };
}

// If individual LSI research fails, continue with others
// (handled in parallel research with try/catch per keyword)
```

### Status Updates

```typescript
await supabase
  .from('content_plan_outline_statuses')
  .insert({
    outline_guid: job_id,
    status: 'extracting_lsi_keywords'
  });

await supabase
  .from('content_plan_outline_statuses')
  .insert({
    outline_guid: job_id,
    status: 'researching_lsi_keywords',
    metadata: { keywords: lsiKeywords }
  });

await supabase
  .from('content_plan_outline_statuses')
  .insert({
    outline_guid: job_id,
    status: 'lsi_research_complete',
    metadata: { total_results: totalResults }
  });
```

---

## 📝 Prompt Engineering for Outline

### No Changes Needed! 🎉

`fast-analyze-outline-content` already reads ALL results from `outline_search_results`:

```typescript
const { data: searchResults, error: resultsError } = await supabase
  .from('outline_search_results')
  .select('*')
  .eq('job_id', job_id);  // Gets ALL results, including LSI
```

The AI will automatically use all 30-40 results when generating the outline.

### Optional: Enhance Context with LSI Awareness

```typescript
// Optional enhancement in fast-analyze-outline-content
const primaryResults = searchResults.filter(r => !r.lsi_keyword);
const lsiResults = searchResults.filter(r => r.lsi_keyword);

const researchContext = `
**Primary Keyword Research** (${primaryResults.length} results):
${formatResults(primaryResults)}

**Related Keyword Research** (${lsiResults.length} results):
${formatResults(lsiResults)}
`;
```

---

## 🧪 Testing Strategy

### Unit Tests

1. **Test LSI Extraction**:
```typescript
// Input: 5 titles, 30 headings for "content marketing"
// Expected: ["content strategy template", "digital marketing plan", "content calendar"]
```

2. **Test Deduplication**:
```typescript
// Input: LSI keywords = ["content marketing", "CONTENT MARKETING", "content strategy"]
// Primary: "content marketing"
// Expected: ["content strategy"] (deduplicated, primary removed)
```

3. **Test Parallel Research**:
```typescript
// Input: 3 LSI keywords
// Expected: 3 sets of results saved to database
// Timing: Should complete in ~30s (not 90s sequential)
```

### Integration Tests

1. **Full Pipeline**:
```bash
# Step 1
curl -X POST .../fast-outline-search -d '{"job_id": "test-123"}'

# Step 2 (new)
curl -X POST .../fast-lsi-extract-and-research -d '{"job_id": "test-123"}'

# Step 3
curl -X POST .../fast-analyze-outline-content -d '{"job_id": "test-123"}'

# Verify: outline_search_results should have 30-40 results
# Verify: outline uses content from LSI results
```

2. **Graceful Degradation**:
```typescript
// Test: LSI extraction returns empty array
// Expected: Pipeline continues, outline generated with primary keyword only
```

---

## 🎯 Success Metrics

### How to Measure Success

1. **LSI Extraction Rate**:
   - Target: >80% of jobs successfully extract 2-3 LSI keywords
   - Monitor: `COUNT(lsi_keywords) FROM outline_generation_jobs`

2. **Research Volume**:
   - Before: 10 results per job
   - After: 30-40 results per job
   - Target: 3-4x increase

3. **Outline Quality** (Manual Review):
   - More diverse section topics?
   - Better coverage of subtopics?
   - More semantic variations?

4. **Performance**:
   - Target: <45s for `fast-lsi-extract-and-research`
   - Acceptable: Pipeline completes in <3 minutes total

---

## 🚀 Implementation Phases

### Phase 1: Foundation (Week 1)
- [ ] Create database migration for `lsi_keyword` column
- [ ] Create database migration for `lsi_keywords` array
- [ ] Create `fast-lsi-extract-and-research` function skeleton
- [ ] Implement `extractLSIKeywords()` function
- [ ] Unit test LSI extraction

### Phase 2: Core Logic (Week 1-2)
- [ ] Implement `researchLSIKeywords()` function
- [ ] Add parallel research with Promise.all
- [ ] Add error handling and graceful degradation
- [ ] Test with real keywords

### Phase 3: Integration (Week 2)
- [ ] Deploy `fast-lsi-extract-and-research`
- [ ] Test full pipeline (search → LSI → analyze)
- [ ] Add status updates to database
- [ ] Monitor performance and errors

### Phase 4: Optimization (Week 3)
- [ ] Optional: Enhance `fast-analyze-outline-content` to show LSI context
- [ ] Optional: Add LSI keywords to outline metadata
- [ ] Performance tuning if needed
- [ ] Documentation and examples

---

## ⚠️ Critical Considerations

### 1. Token Limits in Prompts

**Problem**: 40 results = 4x more tokens in outline prompt

**Solution**:
- Truncate content previews to 1000 chars (currently 1500)
- Or: Limit to top 25 results total (primary + top LSI results)
- Monitor: Groq API errors for token limits

### 2. Edge Function Timeouts

**Problem**: LSI research adds 20-40s

**Solution**:
- Make LSI optional (can be skipped)
- Use parallel research (not sequential)
- Set generous timeout (60s) for LSI function

### 3. Cost Implications

**Problem**: 4x more API calls to Groq

**Impact**:
- Primary research: 1 call
- LSI extraction: 1 call
- LSI research: 3 calls
- **Total: 5 calls per job** (vs 1 currently)

**Mitigation**:
- Make LSI opt-in (default off initially)
- Add cost tracking
- Monitor usage

### 4. Database Storage

**Problem**: 4x more data stored

**Solution**:
- Already handling 10 results per job
- 40 results per job is manageable
- Consider adding retention policy (delete old search results after 30 days)

---

## 🎛️ Configuration Options

### Make LSI Configurable

**Option 1: Per-Domain Setting** (via pairs table):
```json
{
  "enable_lsi": true,
  "lsi_max_keywords": 3
}
```

**Option 2: Per-Job Parameter**:
```typescript
POST /fast-lsi-extract-and-research
{
  "job_id": "uuid",
  "max_keywords": 3,  // 0 = disable LSI
  "enabled": true     // false = skip entirely
}
```

**Option 3: Global Environment Variable**:
```bash
LSI_ENABLED=true
LSI_MAX_KEYWORDS=3
```

**Recommendation**: Start with Option 2 (per-job), add Option 1 (per-domain) later

---

## 📚 References

### Python Implementation Files

- `content_v6/research.py` - Lines 234-314: `extract_related_keywords()`
- `content_v6/workflow.py` - Lines 222-314: `run_research()` orchestration

### TypeScript Implementation Files (To Create/Modify)

- **NEW**: `supabase/functions/fast-lsi-extract-and-research/index.ts`
- **NEW**: `supabase/migrations/YYYYMMDD_add_lsi_support.sql`
- **MODIFY**: `fast-analyze-outline-content/index.ts` (optional enhancements)
- **DOCS**: Add LSI usage guide

---

## 🎬 Example Output

### Before LSI (Current State)

```
Job: "content marketing strategy"
Keywords Researched: 1
Total Results: 10

Outline Sections:
1. What is Content Marketing Strategy
2. Creating a Content Plan
3. Content Distribution Channels
4. Measuring Success
5. Best Practices
```

### After LSI (Enhanced)

```
Job: "content marketing strategy"
Keywords Researched: 4
  - content marketing strategy (primary)
  - content marketing plan template
  - digital storytelling framework
  - multichannel content roadmap

Total Results: 38

Outline Sections:
1. Understanding Content Marketing Strategy Fundamentals
2. Building Your Content Marketing Plan Framework
3. Creating Effective Content Templates and Workflows
4. Digital Storytelling Techniques for Brands
5. Multichannel Content Distribution Strategy
6. Content Calendar Development and Management
7. Measuring ROI and Content Performance
8. Optimizing Your Content Marketing Roadmap for 2025
```

**Notice**: More diverse topics, better coverage, more semantic variations!

---

## ✅ Decision: Ready to Implement?

### Recommendation: **YES, with Option B Architecture**

**Rationale**:
1. ✅ Clear implementation path
2. ✅ Graceful degradation strategy
3. ✅ Performance acceptable (3min total)
4. ✅ Modular and testable
5. ✅ Significant value (4x research data)

**Next Steps**:
1. Get user approval on architecture
2. Create database migrations
3. Implement `fast-lsi-extract-and-research` function
4. Test with real data
5. Deploy and monitor

---

**Status**: 📋 Planning Complete - Ready for Review  
**Estimated Implementation Time**: 2-3 weeks  
**Risk Level**: Low (with graceful degradation)  
**Value**: High (4x more research data for better outlines)

