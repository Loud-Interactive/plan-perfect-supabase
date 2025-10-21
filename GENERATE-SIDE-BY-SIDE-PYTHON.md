# Calling generate-side-by-side from Python

## ✅ Deployment Status

**Function:** `generate-side-by-side`  
**Status:** ✅ Deployed with `--no-verify-jwt`  
**URL:** `https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/generate-side-by-side`  
**Authentication:** None required (no JWT verification)

---

## 🎯 What This Function Does

The `generate-side-by-side` function:

1. ✅ **Respects `edited_content`** - Uses existing markdown if available
2. ✅ **Respects `post_json`** - Uses existing JSON if available  
3. ✅ **Generates markdown** - Only if `edited_content` is empty (using Claude)
4. ✅ **Converts to JSON** - Only if `post_json` is empty (deterministic parser)
5. ✅ **Adds AI callouts** - Enhances content with Groq-generated callouts
6. ✅ **Constructs HTML** - Builds final HTML with styling and schema
7. ✅ **Generates schema** - Creates JSON-LD schema for SEO

### Smart Content Handling

- **First run**: Generates everything fresh
- **Subsequent runs**: Uses existing `edited_content` and `post_json`
- **Manual edits**: Always preserved - never overwritten
- **Only updates**: `post_html`, `content`, `schema_data`, `status`

---

## 📋 Prerequisites

```bash
pip install requests
```

Optional (for database integration):
```bash
pip install supabase
```

---

## 🚀 Quick Start

### Minimal Example

```python
import requests

FUNCTION_URL = "https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/generate-side-by-side"

def generate_html(task_id: str):
    response = requests.post(
        FUNCTION_URL,
        json={"task_id": task_id},
        headers={"Content-Type": "application/json"},
        timeout=300  # 5 minutes
    )
    
    response.raise_for_status()
    return response.json()

# Usage
result = generate_html("your-task-uuid-here")

if result['success']:
    print(f"✅ HTML generated: {len(result['html'])} chars")
else:
    print(f"❌ Error: {result['error']}")
```

### Using the Quickstart Script

```bash
# Edit the task ID in the script
vim generate-side-by-side-quickstart.py

# Run it
python generate-side-by-side-quickstart.py
```

---

## 📝 Request Format

### Request Body

```json
{
  "task_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Required Field:**
- `task_id` (string): UUID of the task to process

### Headers

```python
headers = {
    "Content-Type": "application/json"
}
```

**Note:** No `Authorization` header needed (deployed with `--no-verify-jwt`)

---

## 📦 Response Format

### Success Response

```json
{
  "success": true,
  "status": "completed",
  "task_id": "550e8400-e29b-41d4-a716-446655440000",
  "html": "<html>...</html>",
  "schema": {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": "...",
    "author": {...},
    "datePublished": "...",
    "articleBody": "..."
  },
  "generatedMarkdown": false,  // true if markdown was generated, false if used existing
  "generatedJson": false,       // true if JSON was generated, false if used existing
  "schemaGenerated": true,
  "htmlLength": 45230
}
```

### Error Response

```json
{
  "success": false,
  "error": "Error message here",
  "task_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

---

## 📖 Complete Examples

### Example 1: Basic Usage

```python
import requests
import json

FUNCTION_URL = "https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/generate-side-by-side"

def generate_html(task_id: str) -> dict:
    """Generate HTML for a task"""
    print(f"🚀 Generating HTML for: {task_id}")
    
    response = requests.post(
        FUNCTION_URL,
        json={"task_id": task_id},
        headers={"Content-Type": "application/json"},
        timeout=300
    )
    
    response.raise_for_status()
    result = response.json()
    
    if result['success']:
        print(f"✅ Success! HTML: {len(result['html'])} chars")
        
        # Check if existing content was used
        if not result.get('generatedMarkdown'):
            print("   ℹ️  Used existing edited_content")
        if not result.get('generatedJson'):
            print("   ℹ️  Used existing post_json")
    else:
        print(f"❌ Failed: {result['error']}")
    
    return result

# Use it
result = generate_html("your-task-id")
```

### Example 2: With Error Handling

```python
import requests
from time import sleep

def generate_with_retry(task_id: str, max_retries: int = 3):
    """Generate HTML with automatic retries"""
    
    for attempt in range(1, max_retries + 1):
        print(f"\n🔄 Attempt {attempt}/{max_retries}")
        
        try:
            response = requests.post(
                FUNCTION_URL,
                json={"task_id": task_id},
                headers={"Content-Type": "application/json"},
                timeout=300
            )
            
            response.raise_for_status()
            result = response.json()
            
            if result['success']:
                print(f"✅ Success on attempt {attempt}!")
                return result
            else:
                print(f"⚠️  Failed: {result['error']}")
                if attempt < max_retries:
                    sleep(5)
                    
        except requests.exceptions.Timeout:
            print(f"⏰ Timeout on attempt {attempt}")
            if attempt < max_retries:
                sleep(5)
                
        except requests.exceptions.RequestException as e:
            print(f"❌ Request error: {e}")
            if attempt < max_retries:
                sleep(5)
    
    return {"success": False, "error": f"Failed after {max_retries} attempts"}

# Use it
result = generate_with_retry("your-task-id")
```

### Example 3: Batch Processing

```python
from concurrent.futures import ThreadPoolExecutor, as_completed

def process_batch(task_ids: list, max_workers: int = 3):
    """Process multiple tasks in parallel"""
    
    results = []
    
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        # Submit all tasks
        future_to_task = {
            executor.submit(generate_html, task_id): task_id
            for task_id in task_ids
        }
        
        # Collect results
        for future in as_completed(future_to_task):
            task_id = future_to_task[future]
            
            try:
                result = future.result()
                results.append({
                    "task_id": task_id,
                    "success": result['success'],
                    "html_length": len(result.get('html', ''))
                })
                print(f"✅ Completed: {task_id}")
                
            except Exception as e:
                results.append({
                    "task_id": task_id,
                    "success": False,
                    "error": str(e)
                })
                print(f"❌ Failed: {task_id}")
    
    # Summary
    successful = sum(1 for r in results if r['success'])
    print(f"\n📊 Results: {successful}/{len(results)} successful")
    
    return results

# Use it
task_ids = ["task-1", "task-2", "task-3"]
results = process_batch(task_ids)
```

### Example 4: Save Output to Files

```python
def generate_and_save(task_id: str, output_dir: str = "."):
    """Generate HTML and save to files"""
    import os
    import json
    
    result = generate_html(task_id)
    
    if result['success']:
        # Create output directory
        os.makedirs(output_dir, exist_ok=True)
        
        # Save HTML
        html_path = os.path.join(output_dir, f"{task_id}.html")
        with open(html_path, 'w', encoding='utf-8') as f:
            f.write(result['html'])
        print(f"📄 HTML saved: {html_path}")
        
        # Save schema
        if result.get('schema'):
            schema_path = os.path.join(output_dir, f"{task_id}-schema.json")
            with open(schema_path, 'w', encoding='utf-8') as f:
                json.dump(result['schema'], f, indent=2)
            print(f"📄 Schema saved: {schema_path}")
        
        return True
    
    return False

# Use it
generate_and_save("your-task-id", output_dir="./generated")
```

---

## 🔄 Workflow Integration

### Complete Pipeline Example

```python
import requests
from supabase import create_client

# Initialize clients
SUPABASE_URL = "https://jsypctdhynsdqrfifvdh.supabase.co"
SUPABASE_KEY = "your-service-role-key"

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

def complete_workflow(outline_guid: str):
    """Complete workflow: Outline → HTML → Update Status"""
    
    print(f"🚀 Starting workflow for outline: {outline_guid}")
    
    # Step 1: Get task ID for outline
    print("📋 Step 1: Looking up task...")
    response = supabase.table('tasks') \
        .select('task_id') \
        .eq('content_plan_outline_guid', outline_guid) \
        .order('created_at', desc=True) \
        .limit(1) \
        .execute()
    
    if not response.data:
        print("❌ No task found for outline")
        return False
    
    task_id = response.data[0]['task_id']
    print(f"   Found task: {task_id}")
    
    # Step 2: Generate HTML
    print("\n🎨 Step 2: Generating HTML...")
    result = generate_html(task_id)
    
    if not result['success']:
        print(f"❌ HTML generation failed: {result['error']}")
        return False
    
    print(f"   ✅ HTML generated: {len(result['html'])} chars")
    
    # Step 3: Update task status
    print("\n📝 Step 3: Updating task status...")
    supabase.table('tasks') \
        .update({'status': 'html_generated'}) \
        .eq('task_id', task_id) \
        .execute()
    
    print("   ✅ Status updated")
    
    print(f"\n🎉 Workflow complete for outline: {outline_guid}")
    return True

# Use it
complete_workflow("your-outline-guid-here")
```

---

## ⚠️ Important Notes

### Timeouts
- Default timeout: **5 minutes** (300 seconds)
- Processing time varies based on:
  - Outline size (more sections = longer)
  - Whether content exists (existing = faster)
  - AI callout generation (adds ~30-60s)
  - Schema generation (adds ~10-20s)

### Content Preservation
- **`edited_content` is NEVER overwritten** if it exists
- **`post_json` is NEVER overwritten** if it exists
- Manual edits are always preserved
- Only `post_html`, `content`, `schema_data`, and `status` are updated

### Rate Limiting
- No built-in rate limiting (deployed without JWT)
- Implement your own rate limiting if processing many tasks
- Consider adding delays between requests

### Error Handling
- Always use `try/except` blocks
- Check `result['success']` before accessing data
- Implement retries for transient errors
- Log failures for debugging

---

## 🐛 Troubleshooting

### Problem: Timeout after 5 minutes

**Solution:**
```python
# Increase timeout
response = requests.post(FUNCTION_URL, json={...}, timeout=600)  # 10 minutes
```

### Problem: "Task not found"

**Check:**
1. Task exists in database
2. Task ID is correct UUID format
3. Task has associated outline

### Problem: Empty HTML returned

**Check:**
1. Outline has valid sections
2. Outline data is properly formatted
3. Check function logs in Supabase dashboard

### Problem: Existing content not being used

**Check:**
1. `edited_content` field is not empty in database
2. `post_json` field is not empty in database
3. Check function logs for "Found existing markdown" messages

---

## 📊 Monitoring

### Check Function Logs

```python
# View logs in Supabase dashboard:
# https://supabase.com/dashboard/project/jsypctdhynsdqrfifvdh/functions/generate-side-by-side/logs
```

### Track Performance

```python
import time

def generate_with_timing(task_id: str):
    start = time.time()
    result = generate_html(task_id)
    duration = time.time() - start
    
    print(f"⏱️  Duration: {duration:.2f}s")
    
    return result, duration
```

---

## 📚 Additional Resources

- **Comprehensive Examples:** `generate-side-by-side-python-example.py`
- **Quick Start:** `generate-side-by-side-quickstart.py`
- **Function Logs:** [Supabase Dashboard](https://supabase.com/dashboard/project/jsypctdhynsdqrfifvdh/functions)

---

**Last Updated:** October 16, 2025  
**Function Status:** ✅ Live (deployed with --no-verify-jwt)

