# How to Call generate-side-by-side for Task ID: 4b0f2b87-2c37-4cad-b7af-f9aa42ed73e3

## 🚨 Important: Function Requires `outline_guid`

The `generate-side-by-side` function requires an `outline_guid`, not a `task_id`.

You need to:
1. Find the `outline_guid` for your task
2. Call the function with that `outline_guid`

---

## Option 1: Find the Outline GUID (Recommended)

### Step 1: Query the Database

```sql
SELECT 
    task_id,
    content_plan_outline_guid,
    title,
    status
FROM tasks
WHERE task_id = '4b0f2b87-2c37-4cad-b7af-f9aa42ed73e3';
```

**Run this in:**
- Supabase SQL Editor
- psql: `psql $DATABASE_URL -f get-outline-guid.sql`
- Python/Node.js query

### Step 2: Use the Outline GUID

Once you have the `outline_guid`, call the function:

```bash
curl -X POST \
  "https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/generate-side-by-side" \
  -H "Content-Type: application/json" \
  -d '{
    "outline_guid": "YOUR-OUTLINE-GUID-HERE",
    "task_id": "4b0f2b87-2c37-4cad-b7af-f9aa42ed73e3"
  }'
```

---

## Option 2: Python Script with Database Lookup

```python
# Edit the service key in call-generate-side-by-side-fixed.py
SUPABASE_SERVICE_KEY = "your-service-key-here"

# Then run:
python call-generate-side-by-side-fixed.py
```

The script will:
1. Look up the outline_guid from the task_id
2. Call generate-side-by-side with the correct parameters
3. Save the output HTML and schema

---

## Option 3: If You Already Know the Outline GUID

```python
import requests

outline_guid = "YOUR-OUTLINE-GUID"  # Replace this
task_id = "4b0f2b87-2c37-4cad-b7af-f9aa42ed73e3"

response = requests.post(
    "https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/generate-side-by-side",
    json={
        "outline_guid": outline_guid,
        "task_id": task_id  # Optional, helps find existing task
    },
    headers={"Content-Type": "application/json"},
    timeout=600
)

result = response.json()
print(result)
```

---

## Option 4: Direct curl (No Auth Required)

If you know the outline GUID:

```bash
curl -X POST \
  "https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/generate-side-by-side" \
  -H "Content-Type: application/json" \
  -d '{
    "outline_guid": "PASTE-YOUR-OUTLINE-GUID-HERE",
    "task_id": "4b0f2b87-2c37-4cad-b7af-f9aa42ed73e3"
  }' \
  | jq .
```

---

## Understanding the Parameters

### Required:
- **`outline_guid`** (string) - The content plan outline GUID
  - This is the primary identifier
  - Links to the outline in `content_plan_outlines` table

### Optional:
- **`task_id`** (string) - The specific task ID to update
  - If not provided, function will find or create a task
  - Helps ensure you update the correct task

---

## What the Function Does

1. ✅ Fetches outline data using `outline_guid`
2. ✅ Finds existing task (or creates one)
3. ✅ Checks for existing `edited_content` (uses if exists)
4. ✅ Checks for existing `post_json` (uses if exists)
5. ✅ Generates markdown (only if needed)
6. ✅ Converts to JSON (only if needed)
7. ✅ Adds AI callouts with Groq
8. ✅ Constructs HTML
9. ✅ Generates schema
10. ✅ Updates task in database

---

## Expected Response

```json
{
  "success": true,
  "status": "completed",
  "task_id": "4b0f2b87-2c37-4cad-b7af-f9aa42ed73e3",
  "html": "<html>...</html>",
  "schema": {...},
  "generatedMarkdown": false,  // true if new, false if used existing
  "generatedJson": false,       // true if new, false if used existing
  "schemaGenerated": true,
  "htmlLength": 45230
}
```

---

## Next Steps

**Choose your method:**

1. **Fastest**: Get outline_guid from database, use curl
2. **Easiest**: Update service key in Python script, run it
3. **Most flexible**: Use the Supabase dashboard SQL editor

**Then:**
- Check the generated HTML file
- Review the schema
- Update task as needed

---

## Troubleshooting

### "Missing required field: outline_guid"
→ You passed `task_id` but not `outline_guid`  
→ Query the database to get the `outline_guid`

### "Outline not found"
→ The `outline_guid` doesn't exist in `content_plan_outlines`  
→ Verify the GUID is correct

### "Timeout after 10 minutes"
→ Large outline taking too long  
→ Check Supabase function logs for progress

---

**Files created:**
- `get-outline-guid.sql` - Query to find outline GUID
- `call-generate-side-by-side-fixed.py` - Python script with lookup
- `call-generate-side-by-side.py` - Simple direct call (needs update)

**Last Updated:** October 16, 2025

