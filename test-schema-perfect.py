#!/usr/bin/env python3
"""
Quick test script for generate-schema-perfect endpoint
"""

import requests
import json
import re
import sys

def test_schema_perfect(url):
    """Test the generate-schema-perfect endpoint"""
    
    api_url = "https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/generate-schema-perfect"
    
    print(f"🚀 Testing generate-schema-perfect")
    print(f"📝 URL: {url}")
    print(f"🌐 Endpoint: {api_url}")
    print("\n" + "="*60 + "\n")
    
    try:
        response = requests.post(
            api_url,
            json={"url": url},
            headers={"Content-Type": "application/json"},
            stream=True,
            timeout=120
        )
        
        if response.status_code != 200:
            print(f"❌ Error: HTTP {response.status_code}")
            print(response.text)
            return None
        
        print("📡 Streaming response:\n")
        
        full_response = ""
        in_processing = False
        in_thinking = False
        in_schema = False
        
        for line in response.iter_lines():
            if line:
                text = line.decode('utf-8')
                full_response += text + "\n"
                
                # Track sections
                if '<processing>' in text:
                    in_processing = True
                    print("🔄 PROCESSING:")
                    continue
                elif '</processing>' in text:
                    in_processing = False
                    print()
                    continue
                elif '<think>' in text:
                    in_thinking = True
                    print("🧠 THINKING:")
                    continue
                elif '</think>' in text:
                    in_thinking = False
                    print("\n📄 SCHEMA:")
                    in_schema = True
                    continue
                
                # Print with appropriate prefix
                if in_processing:
                    print(f"  {text}")
                elif in_thinking:
                    if not text.strip() == '.':  # Skip heartbeat dots
                        print(f"  {text}")
                elif in_schema or text.strip().startswith('{'):
                    in_schema = True
                    print(text)
        
        print("\n" + "="*60)
        print("✅ Response complete!")
        
        # Extract and validate JSON
        print("\n🔍 Extracting JSON-LD...")
        cleaned = re.sub(r'<processing>.*?</processing>', '', full_response, flags=re.DOTALL)
        cleaned = re.sub(r'<think>.*?</think>', '', cleaned, flags=re.DOTALL)
        cleaned = cleaned.strip()
        
        try:
            schema = json.loads(cleaned)
            print(f"✅ Valid JSON-LD schema generated!")
            print(f"📋 Type: {schema.get('@type')}")
            
            if 'headline' in schema:
                print(f"📰 Headline: {schema.get('headline')[:60]}...")
            elif 'name' in schema:
                print(f"🏷️  Name: {schema.get('name')[:60]}...")
            
            # Count fields
            field_count = len(schema.keys())
            print(f"📊 Fields: {field_count}")
            
            return schema
            
        except json.JSONDecodeError as e:
            print(f"❌ Invalid JSON: {e}")
            print("\nCleaned response:")
            print(cleaned[:500])
            return None
            
    except requests.exceptions.Timeout:
        print("❌ Request timed out after 120 seconds")
        return None
    except requests.exceptions.RequestException as e:
        print(f"❌ Request failed: {e}")
        return None
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        return None

def main():
    if len(sys.argv) > 1:
        test_url = sys.argv[1]
    else:
        # Default test URL
        test_url = "https://www.loudinteractive.com/blog/local-seo-tips"
    
    schema = test_schema_perfect(test_url)
    
    if schema:
        # Save to file
        output_file = "test-schema-output.json"
        with open(output_file, 'w') as f:
            json.dump(schema, f, indent=2)
        print(f"\n💾 Schema saved to: {output_file}")
        
        # Show sample
        print("\n📝 Sample of generated schema:")
        print(json.dumps(schema, indent=2)[:500] + "...")
    else:
        print("\n❌ Test failed")
        sys.exit(1)

if __name__ == '__main__':
    main()

