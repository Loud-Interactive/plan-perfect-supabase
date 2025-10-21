#!/usr/bin/env python3
"""
Quick-start example for generate-side-by-side edge function
No authentication required (deployed with --no-verify-jwt)
"""

import requests
import json

# Configuration
SUPABASE_URL = "https://jsypctdhynsdqrfifvdh.supabase.co"
FUNCTION_URL = f"{SUPABASE_URL}/functions/v1/generate-side-by-side"


def generate_html(task_id: str) -> dict:
    """
    Generate HTML from outline for a given task
    
    Args:
        task_id: The task UUID to process
        
    Returns:
        dict: Response from the function
    """
    print(f"🚀 Generating HTML for task: {task_id}")
    
    response = requests.post(
        FUNCTION_URL,
        json={"task_id": task_id},
        headers={"Content-Type": "application/json"},
        timeout=300  # 5 minutes
    )
    
    response.raise_for_status()
    result = response.json()
    
    if result.get('success'):
        print(f"✅ Success!")
        print(f"   Status: {result.get('status')}")
        print(f"   HTML Length: {len(result.get('html', ''))} chars")
        print(f"   Used existing edited_content: {not result.get('generatedMarkdown', True)}")
        print(f"   Used existing post_json: {not result.get('generatedJson', True)}")
        print(f"   Schema Generated: {result.get('schemaGenerated', False)}")
    else:
        print(f"❌ Failed: {result.get('error')}")
    
    return result


# Example usage
if __name__ == "__main__":
    # Replace with your actual task UUID
    TASK_ID = "your-task-uuid-here"
    
    try:
        result = generate_html(TASK_ID)
        
        # Save HTML to file if successful
        if result.get('success'):
            html = result.get('html', '')
            
            with open('generated-output.html', 'w', encoding='utf-8') as f:
                f.write(html)
            print(f"\n📄 HTML saved to: generated-output.html")
            
            # Save schema if available
            if result.get('schema'):
                with open('generated-schema.json', 'w', encoding='utf-8') as f:
                    json.dump(result['schema'], f, indent=2)
                print(f"📄 Schema saved to: generated-schema.json")
        
    except requests.exceptions.Timeout:
        print("⏰ Request timed out after 5 minutes")
    except requests.exceptions.RequestException as e:
        print(f"❌ Request failed: {e}")
    except Exception as e:
        print(f"❌ Error: {e}")

