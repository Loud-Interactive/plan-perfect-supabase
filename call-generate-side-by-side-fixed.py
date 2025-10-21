#!/usr/bin/env python3
"""
Call generate-side-by-side - handles both task_id and outline_guid
"""

import requests
import json
import time
from supabase import create_client

SUPABASE_URL = "https://jsypctdhynsdqrfifvdh.supabase.co"
SUPABASE_SERVICE_KEY = "YOUR-SERVICE-KEY-HERE"  # Update this!
FUNCTION_URL = f"{SUPABASE_URL}/functions/v1/generate-side-by-side"

# Your task ID
TASK_ID = "4b0f2b87-2c37-4cad-b7af-f9aa42ed73e3"

print(f"🔍 Looking up outline GUID for task: {TASK_ID}\n")

# Initialize Supabase client
try:
    supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    
    # Get the outline GUID from the task
    response = supabase.table('tasks') \
        .select('content_plan_outline_guid, title, status') \
        .eq('task_id', TASK_ID) \
        .single() \
        .execute()
    
    if not response.data:
        print(f"❌ Task not found: {TASK_ID}")
        exit(1)
    
    outline_guid = response.data['content_plan_outline_guid']
    title = response.data.get('title', 'N/A')
    status = response.data.get('status', 'N/A')
    
    print(f"✅ Found task:")
    print(f"   Title: {title}")
    print(f"   Status: {status}")
    print(f"   Outline GUID: {outline_guid}\n")
    
    if not outline_guid:
        print(f"❌ Task has no outline GUID associated")
        exit(1)
    
except Exception as e:
    print(f"❌ Database lookup failed: {e}")
    print(f"\n💡 Alternatively, provide the outline_guid directly:")
    print(f"   python call-generate-side-by-side-fixed.py <outline-guid>")
    exit(1)

# Now call generate-side-by-side
print(f"🚀 Calling generate-side-by-side...\n")
print(f"⏰ This may take 2-5 minutes...\n")

start_time = time.time()

try:
    response = requests.post(
        FUNCTION_URL,
        json={
            "outline_guid": outline_guid,
            "task_id": TASK_ID  # Optional, helps function find existing task
        },
        headers={"Content-Type": "application/json"},
        timeout=600  # 10 minutes
    )
    
    duration = time.time() - start_time
    
    print(f"⏱️  Duration: {duration:.1f} seconds\n")
    
    # Check status code
    if response.status_code != 200:
        print(f"❌ HTTP Error: {response.status_code}")
        print(f"Response: {response.text}\n")
        exit(1)
    
    result = response.json()
    
    # Display results
    print("="*70)
    print("RESULTS")
    print("="*70 + "\n")
    
    if result.get('success'):
        print(f"✅ Success!")
        print(f"\n📊 Details:")
        print(f"   Task ID: {result.get('task_id')}")
        print(f"   Status: {result.get('status')}")
        print(f"   HTML Length: {len(result.get('html', ''))} characters")
        
        print(f"\n📝 Content Status:")
        print(f"   Used existing edited_content: {not result.get('generatedMarkdown', True)}")
        print(f"   Used existing post_json: {not result.get('generatedJson', True)}")
        print(f"   Schema Generated: {result.get('schemaGenerated', False)}")
        
        # Save HTML to file
        html_filename = f"output-{TASK_ID}.html"
        with open(html_filename, 'w', encoding='utf-8') as f:
            f.write(result.get('html', ''))
        print(f"\n💾 HTML saved to: {html_filename}")
        
        # Save schema if available
        if result.get('schema'):
            schema_filename = f"schema-{TASK_ID}.json"
            with open(schema_filename, 'w', encoding='utf-8') as f:
                json.dump(result['schema'], f, indent=2)
            print(f"💾 Schema saved to: {schema_filename}")
        
        print(f"\n🎉 Complete!")
        
    else:
        print(f"❌ Failed!")
        print(f"   Error: {result.get('error')}")
        print(f"\n📋 Full response:")
        print(json.dumps(result, indent=2))
        
except requests.exceptions.Timeout:
    print(f"⏰ Request timed out after 10 minutes")
    print(f"   The job may still be running on the server.")
    print(f"   Check the Supabase dashboard for logs.")
    
except requests.exceptions.RequestException as e:
    print(f"❌ Request failed: {e}")
    
except Exception as e:
    print(f"❌ Error: {e}")

print("\n" + "="*70)

