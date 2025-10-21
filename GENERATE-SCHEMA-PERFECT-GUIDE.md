# Generate Schema Perfect - Complete Guide

## 🎯 Overview

`generate-schema-perfect` is a comprehensive AI-powered JSON-LD schema generation endpoint that intelligently classifies pages and generates perfect, SEO-optimized structured data.

**Deployed At:** `https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/generate-schema-perfect`

## ✨ Features

### 🧠 Intelligent Page Classification
- **8 Schema Types Supported:**
  - Article (blog posts, news)
  - Product (e-commerce)
  - Recipe (cooking/food)
  - HowTo (tutorials)
  - Event (conferences, webinars)
  - FAQPage (Q&A pages)
  - VideoObject (video content)
  - LocalBusiness (physical locations)

### 🔍 Advanced Analysis
- Automatic page type detection with confidence scoring
- Content characteristics analysis (author, dates, images, prices, reviews, etc.)
- Primary and secondary type identification
- Domain-specific customization support

### 🚀 Smart Generation
- Streaming responses for real-time feedback
- Domain context integration from pp-api
- Custom prompts per domain
- Template support for consistent schemas
- Full schema.org compliance

## 📋 API Reference

### Endpoint
```
POST https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/generate-schema-perfect
```

### Request Body

**Option 1: Direct URL**
```json
{
  "url": "https://example.com/article"
}
```

**Option 2: Outline GUID**
```json
{
  "content_plan_outline_guid": "your-outline-guid-here"
}
```

**Option 3: Task ID**
```json
{
  "task_id": "your-task-id-here"
}
```

**Option 4: Legacy parameter**
```json
{
  "live_post_url": "https://example.com/article"
}
```

### Response

Streaming text response with tags:
```
<processing>
... setup steps ...
</processing>

<think>
... classification and reasoning ...
</think>

{
  "@context": "https://schema.org",
  "@type": "Article",
  ...complete JSON-LD schema...
}
```

## 🐍 Python Examples

### Example 1: Basic URL Schema Generation
```python
import requests

url = "https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/generate-schema-perfect"
headers = {
    "Content-Type": "application/json"
}

payload = {
    "url": "https://example.com/blog/how-to-cook-pasta"
}

response = requests.post(url, json=payload, headers=headers, stream=True)

print("Streaming response:")
for line in response.iter_lines():
    if line:
        print(line.decode('utf-8'))
```

### Example 2: With Outline GUID
```python
import requests

url = "https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/generate-schema-perfect"
headers = {
    "Content-Type": "application/json"
}

payload = {
    "content_plan_outline_guid": "4b0f2b87-2c37-4cad-b7af-f9aa42ed73e3"
}

response = requests.post(url, json=payload, headers=headers, stream=True)

# Extract just the JSON-LD (skip processing/think tags)
schema_lines = []
in_schema = False

for line in response.iter_lines():
    if line:
        text = line.decode('utf-8')
        
        # Skip processing and think sections
        if '<processing>' in text or '<think>' in text:
            in_schema = False
            continue
        if '</processing>' in text or '</think>' in text:
            in_schema = True
            continue
            
        if in_schema or text.strip().startswith('{'):
            in_schema = True
            schema_lines.append(text)

schema_json = ''.join(schema_lines)
print("Generated Schema:")
print(schema_json)
```

### Example 3: Save Schema to File
```python
import requests
import json
import re

def generate_and_save_schema(url_to_analyze, output_file="schema.json"):
    api_url = "https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/generate-schema-perfect"
    
    response = requests.post(
        api_url,
        json={"url": url_to_analyze},
        headers={"Content-Type": "application/json"},
        stream=True
    )
    
    full_response = ""
    for line in response.iter_lines():
        if line:
            full_response += line.decode('utf-8') + "\n"
    
    # Extract JSON-LD from response
    # Remove processing and think tags
    cleaned = re.sub(r'<processing>.*?</processing>', '', full_response, flags=re.DOTALL)
    cleaned = re.sub(r'<think>.*?</think>', '', cleaned, flags=re.DOTALL)
    cleaned = cleaned.strip()
    
    # Parse and pretty-print JSON
    try:
        schema = json.loads(cleaned)
        with open(output_file, 'w') as f:
            json.dump(schema, f, indent=2)
        print(f"✅ Schema saved to {output_file}")
        return schema
    except json.JSONDecodeError as e:
        print(f"❌ Failed to parse JSON: {e}")
        print("Raw response:")
        print(cleaned)
        return None

# Usage
schema = generate_and_save_schema("https://example.com/product/awesome-widget")
```

### Example 4: Batch Processing Multiple URLs
```python
import requests
import json
import time

def generate_schema_for_url(url):
    """Generate schema for a single URL"""
    api_url = "https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/generate-schema-perfect"
    
    response = requests.post(
        api_url,
        json={"url": url},
        headers={"Content-Type": "application/json"},
        stream=True
    )
    
    # Collect response
    lines = []
    for line in response.iter_lines():
        if line:
            lines.append(line.decode('utf-8'))
    
    full_response = '\n'.join(lines)
    
    # Extract just the JSON
    import re
    cleaned = re.sub(r'<processing>.*?</processing>', '', full_response, flags=re.DOTALL)
    cleaned = re.sub(r'<think>.*?</think>', '', cleaned, flags=re.DOTALL)
    cleaned = cleaned.strip()
    
    try:
        return json.loads(cleaned)
    except:
        return None

# Batch process multiple URLs
urls = [
    "https://example.com/blog/article1",
    "https://example.com/blog/article2",
    "https://example.com/products/item1"
]

results = {}
for url in urls:
    print(f"Processing: {url}")
    schema = generate_schema_for_url(url)
    if schema:
        results[url] = schema
        print(f"  ✅ Success - Type: {schema.get('@type')}")
    else:
        print(f"  ❌ Failed")
    
    # Be nice to the API
    time.sleep(2)

# Save all results
with open('batch_schemas.json', 'w') as f:
    json.dump(results, f, indent=2)

print(f"\n✅ Processed {len(results)}/{len(urls)} URLs")
```

## 🔧 cURL Examples

### Basic Request
```bash
curl -X POST "https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/generate-schema-perfect" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/blog/amazing-post"}'
```

### With Pretty Output (requires jq)
```bash
curl -X POST "https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/generate-schema-perfect" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/blog/post"}' \
  | grep -v '<processing>' | grep -v '</processing>' \
  | grep -v '<think>' | grep -v '</think>' \
  | jq '.'
```

## 📊 Response Structure

### Processing Phase
```
<processing>
No direct URL provided. Fetching URL from the database...
Checking content_plan_outlines for GUID: xxx
Found URL in outlines table: https://example.com
Starting schema generation for URL: https://example.com

Step 1: Converting URL to Markdown...
Successfully converted URL to Markdown (12453 characters)

Step 2: Extracting domain data...
Extracted domain: example.com
Domain data retrieved successfully
</processing>
```

### Thinking Phase
```
<think>
Step 3a: Classifying page type...
Classified as: Article (confidence: 0.95)
Reasoning: Content contains article structure with author, date, and main body text

Step 3b: Generating schema with AI using classified type...
Sending request to AI...
.....
Receiving and processing response from AI...
Workflow complete. Streaming schema to user...
</think>
```

### Schema Output
```json
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "...",
  "author": {...},
  "datePublished": "...",
  ...
}
```

## 🎨 Schema Types & Examples

The function automatically classifies pages into these types:

1. **Article** - Blog posts, news articles
2. **Product** - E-commerce products with offers
3. **Recipe** - Cooking instructions with ingredients
4. **HowTo** - Step-by-step tutorials
5. **Event** - Conferences, webinars, concerts
6. **FAQPage** - Question and answer pages
7. **VideoObject** - Video content
8. **LocalBusiness** - Physical business locations

Each type includes all required fields per schema.org specifications.

## 🚀 Integration Tips

1. **Stream Processing**: Use streaming for real-time feedback
2. **Error Handling**: Wrap in try-catch and handle network errors
3. **Rate Limiting**: Add delays between batch requests
4. **Validation**: Validate generated JSON-LD with Google's Rich Results Test
5. **Caching**: Consider caching schemas for frequently accessed URLs

## 📝 Notes

- **No Authentication Required**: Deployed with `--no-verify-jwt`
- **Streaming Response**: Use streaming for better UX
- **Domain Context**: Automatically fetches domain-specific data from pp-api
- **AI Model**: Uses Groq's `openai/gpt-oss-120b` for generation
- **Markdown Conversion**: Uses md.dhr.wtf API for URL → Markdown

## ✅ Testing Checklist

- [ ] Test with direct URL
- [ ] Test with outline_guid
- [ ] Test with task_id  
- [ ] Verify all 8 schema types generate correctly
- [ ] Check streaming output
- [ ] Validate JSON-LD with Google tool
- [ ] Test error handling

## 🐛 Troubleshooting

**Issue**: Function times out
- **Solution**: URL might be too large, check markdown conversion step

**Issue**: Invalid JSON returned
- **Solution**: Check the AI response, may need to extract JSON from text

**Issue**: 400 Bad Request
- **Solution**: Ensure you're providing one of: url, content_plan_outline_guid, or task_id

**Issue**: Schema missing required fields
- **Solution**: Page may not have enough content, check classification confidence

---

**Created**: 2025-10-20  
**Version**: 1.0  
**Status**: ✅ Deployed and Ready

