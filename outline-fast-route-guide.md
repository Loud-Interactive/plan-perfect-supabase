OUTLINE GENERATION - FAST ROUTE GUIDE
═══════════════════════════════════════════════════════════════

📋 OVERVIEW
═══════════════════════════════════════════════════════════════

There are TWO main functions for outline generation:

1. **generate-outline** - Creates a NEW outline from scratch
2. **regenerate-outline** - Regenerates/improves an EXISTING outline

Both support a `fast` parameter to use the Groq-powered fast route.

═══════════════════════════════════════════════════════════════
🚀 GENERATE NEW OUTLINE (Fast Route)
═══════════════════════════════════════════════════════════════

**Function:** `generate-outline`
**Fast Route:** Uses `fast-outline-search` (Groq-powered)

**Endpoint:**
```
POST https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/generate-outline
```

**Request Body:**
```json
{
  "content_plan_guid": "your-content-plan-guid",
  "post_title": "Your Article Title",
  "content_plan_keyword": "main keyword",
  "post_keyword": "article seo keyword",
  "domain": "example.com",
  "fast": true  ← SET THIS TO TRUE FOR FAST ROUTE
}
```

**Python Example:**
```python
import requests
import os

response = requests.post(
    'https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/generate-outline',
    headers={
        'Authorization': f'Bearer {os.getenv("SUPABASE_SERVICE_ROLE_KEY")}',
        'Content-Type': 'application/json'
    },
    json={
        'content_plan_guid': 'your-guid',
        'post_title': 'Your Article Title',
        'content_plan_keyword': 'main keyword',
        'post_keyword': 'article seo keyword',
        'domain': 'example.com',
        'fast': True  # ← FAST ROUTE
    }
)

print(response.json())
# Returns: {"success": true, "job_id": "...", "content_plan_outline_guid": "..."}
```

**cURL Example:**
```bash
curl -X POST \
  'https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/generate-outline' \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "content_plan_guid": "your-guid",
    "post_title": "Your Article Title",
    "content_plan_keyword": "main keyword",
    "post_keyword": "article seo keyword",
    "domain": "example.com",
    "fast": true
  }'
```

**Flow:**
1. Creates job in `outline_generation_jobs` table
2. Routes to `fast-outline-search` (if `fast: true`)
3. `fast-outline-search` uses Groq to search and generate outline
4. Results stored in `content_plan_outlines_ai` table

═══════════════════════════════════════════════════════════════
🔄 REGENERATE EXISTING OUTLINE (Fast Route)
═══════════════════════════════════════════════════════════════

**Function:** `regenerate-outline`
**Fast Route:** Uses `fast-regenerate-outline` (Groq-powered)

**Endpoint:**
```
POST https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/regenerate-outline
```

**Request Body:**
```json
{
  "job_id": "your-job-id",
  "content_plan_outline_guid": "your-outline-guid",  // Alternative to job_id
  "fast": true  ← SET THIS TO TRUE FOR FAST ROUTE
}
```

**Python Example:**
```python
import requests
import os

response = requests.post(
    'https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/regenerate-outline',
    headers={
        'Authorization': f'Bearer {os.getenv("SUPABASE_SERVICE_ROLE_KEY")}',
        'Content-Type': 'application/json'
    },
    json={
        'content_plan_outline_guid': 'your-outline-guid',
        'fast': True  # ← FAST ROUTE
    }
)

print(response.json())
# Returns: {"success": true, "message": "Fast outline regeneration started", "job_id": "...", "mode": "fast"}
```

**cURL Example:**
```bash
curl -X POST \
  'https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/regenerate-outline' \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "content_plan_outline_guid": "your-outline-guid",
    "fast": true
  }'
```

**Flow:**
1. Routes to `fast-regenerate-outline` (if `fast: true`)
2. `fast-regenerate-outline`:
   - Fetches original outline (if exists) - now handles missing gracefully
   - Fetches search results from `outline_search_results`
   - Fetches brand profile from `pairs` table
   - Uses Groq Kimi K2 to generate improved outline
   - Stores result in `content_plan_outlines_ai` table

═══════════════════════════════════════════════════════════════
📊 FAST vs SLOW MODE COMPARISON
═══════════════════════════════════════════════════════════════

**FAST MODE (Groq-powered):**
- ✅ Uses Groq API (faster, cheaper)
- ✅ Uses `fast-outline-search` for initial generation
- ✅ Uses `fast-regenerate-outline` for regeneration
- ✅ Handles missing original outlines gracefully
- ✅ Includes brand context (competitors, positioning, audience)
- ✅ Uses current date awareness

**SLOW MODE (Anthropic-powered):**
- Uses Anthropic Claude API
- Uses `search-outline-content` for initial generation
- Uses `regenerate-outline` slow path for regeneration
- More expensive but potentially higher quality

═══════════════════════════════════════════════════════════════
🔍 HOW TO ENABLE FAST MODE
═══════════════════════════════════════════════════════════════

**For NEW Outlines:**
```json
{
  "fast": true  // Add this field to generate-outline request
}
```

**For REGENERATING Outlines:**
```json
{
  "fast": true  // Add this field to regenerate-outline request
}
```

**Default Behavior:**
- If `fast` is omitted or `false`, uses slow mode (Anthropic)
- If `fast` is `true`, uses fast mode (Groq)
- If fast mode fails, automatically falls back to slow mode

═══════════════════════════════════════════════════════════════
📝 NOTES
═══════════════════════════════════════════════════════════════

**fast-regenerate-outline improvements:**
- ✅ Now handles missing original outlines gracefully
- ✅ Includes note in prompt: "No previous outline was found"
- ✅ Creates comprehensive outline from scratch if needed
- ✅ Uses all available information (research results, brand profile)

**Fast Route Benefits:**
1. Faster generation (Groq is faster than Anthropic)
2. Lower cost (Groq is cheaper)
3. More reliable (better error handling)
4. Brand-aware (includes competitor/positioning context)
5. Date-aware (uses current date in prompts)

═══════════════════════════════════════════════════════════════
✅ SUMMARY
═══════════════════════════════════════════════════════════════

To use the fast route, simply add `"fast": true` to your request:

**Generate New Outline:**
```json
POST /functions/v1/generate-outline
{"fast": true, "post_title": "...", ...}
```

**Regenerate Outline:**
```json
POST /functions/v1/regenerate-outline
{"fast": true, "content_plan_outline_guid": "..."}
```

That's it! The fast route will automatically use Groq-powered functions.

