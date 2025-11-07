#!/usr/bin/env python3
"""
Generate hero image prompt and image from unedited_content
Calls generate-hero-image-prompt with use_unedited_content=True, then generate-hero-image
"""

import httpx
import json
from typing import Optional, Dict, Any

# Configuration - adjust these to match your setup
SUPABASE_URL = "https://jsypctdhynsdqrfifvdh.supabase.co"
SUPABASE_SERVICE_ROLE_KEY = None  # Set this if functions require auth, or leave None if no auth needed


async def generate_hero_image_from_unedited(
    content_plan_outline_guid: str,
    timeout: float = 300.0
) -> Dict[str, Any]:
    """
    Generate hero image prompt from unedited_content, then generate the hero image.
    
    This function:
    1. Calls generate-hero-image-prompt with use_unedited_content=True
    2. Waits for prompt generation to complete
    3. Calls generate-hero-image to generate the actual image
    
    Args:
        content_plan_outline_guid: The content plan outline GUID to process
        timeout: Request timeout in seconds (default 300)
        
    Returns:
        dict with keys: success, prompt_result, image_result, error (if failed)
    """
    try:
        # Step 1: Generate hero image prompt from unedited_content
        print(f"🚀 Step 1: Generating hero image prompt from unedited_content for outline: {content_plan_outline_guid}")
        
        prompt_function_url = f"{SUPABASE_URL}/functions/v1/generate-hero-image-prompt"
        
        headers = {
            "Content-Type": "application/json"
        }
        
        # Add auth header if service key is provided
        if SUPABASE_SERVICE_ROLE_KEY:
            headers["Authorization"] = f"Bearer {SUPABASE_SERVICE_ROLE_KEY}"
        
        prompt_payload = {
            "content_plan_outline_guid": content_plan_outline_guid,
            "use_unedited_content": True
        }
        
        async with httpx.AsyncClient(timeout=timeout, verify=False) as client:
            # Generate prompt
            prompt_response = await client.post(
                prompt_function_url,
                json=prompt_payload,
                headers=headers
            )
            
            if prompt_response.status_code != 200:
                error_text = prompt_response.text
                print(f"❌ Prompt generation failed: HTTP {prompt_response.status_code}")
                print(f"   Response: {error_text[:500]}")
                return {
                    "success": False,
                    "error": f"Prompt generation failed: HTTP {prompt_response.status_code}",
                    "details": error_text[:500]
                }
            
            prompt_result = prompt_response.json()
            
            if prompt_result.get('save_status', {}).get('success'):
                print(f"✅ Hero image prompt generated successfully!")
                print(f"   Prompt ID: {prompt_result.get('save_status', {}).get('hero_image_prompt_id')}")
                print(f"   Content source: {prompt_result.get('content_source', 'unknown')}")
                print(f"   Aspect ratio: {prompt_result.get('aspect_ratio', '16:9')}")
            else:
                print(f"⚠️  Prompt generation completed but save status unclear")
            
            # Step 2: Generate the hero image
            print(f"\n🚀 Step 2: Generating hero image for outline: {content_plan_outline_guid}")
            
            image_function_url = f"{SUPABASE_URL}/functions/v1/generate-hero-image"
            
            image_payload = {
                "guid": content_plan_outline_guid,
                "regenerate": False
            }
            
            image_response = await client.post(
                image_function_url,
                json=image_payload,
                headers=headers
            )
            
            if image_response.status_code != 200:
                error_text = image_response.text
                print(f"❌ Image generation failed: HTTP {image_response.status_code}")
                print(f"   Response: {error_text[:500]}")
                return {
                    "success": False,
                    "error": f"Image generation failed: HTTP {image_response.status_code}",
                    "details": error_text[:500],
                    "prompt_result": prompt_result
                }
            
            image_result = image_response.json()
            
            if image_result.get('success'):
                print(f"✅ Hero image generated successfully!")
                print(f"   Image URL: {image_result.get('hero_image_url', 'N/A')}")
                print(f"   Title: {image_result.get('title', 'N/A')}")
            else:
                print(f"⚠️  Image generation completed but success status unclear")
            
            return {
                "success": True,
                "prompt_result": prompt_result,
                "image_result": image_result,
                "hero_image_url": image_result.get('hero_image_url'),
                "hero_image_prompt_id": prompt_result.get('save_status', {}).get('hero_image_prompt_id')
            }
            
    except httpx.TimeoutException:
        print(f"⏰ Request timed out after {timeout} seconds")
        return {
            "success": False,
            "error": f"Request timed out after {timeout} seconds"
        }
    except httpx.HTTPStatusError as e:
        print(f"❌ HTTP error: {e}")
        print(f"   Status: {e.response.status_code}")
        print(f"   Response: {e.response.text[:500]}")
        return {
            "success": False,
            "error": f"HTTP {e.response.status_code}",
            "details": e.response.text[:500]
        }
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        return {
            "success": False,
            "error": str(e)
        }


# Synchronous version using requests (if you prefer sync)
def generate_hero_image_from_unedited_sync(
    content_plan_outline_guid: str,
    timeout: int = 300
) -> Dict[str, Any]:
    """
    Synchronous version using requests library.
    Same functionality as async version but uses requests instead of httpx.
    """
    import requests
    
    try:
        # Step 1: Generate hero image prompt
        print(f"🚀 Step 1: Generating hero image prompt from unedited_content for outline: {content_plan_outline_guid}")
        
        prompt_function_url = f"{SUPABASE_URL}/functions/v1/generate-hero-image-prompt"
        
        headers = {
            "Content-Type": "application/json"
        }
        
        if SUPABASE_SERVICE_ROLE_KEY:
            headers["Authorization"] = f"Bearer {SUPABASE_SERVICE_ROLE_KEY}"
        
        prompt_payload = {
            "content_plan_outline_guid": content_plan_outline_guid,
            "use_unedited_content": True
        }
        
        prompt_response = requests.post(
            prompt_function_url,
            json=prompt_payload,
            headers=headers,
            timeout=timeout,
            verify=False
        )
        
        prompt_response.raise_for_status()
        prompt_result = prompt_response.json()
        
        if prompt_result.get('save_status', {}).get('success'):
            print(f"✅ Hero image prompt generated successfully!")
            print(f"   Prompt ID: {prompt_result.get('save_status', {}).get('hero_image_prompt_id')}")
            print(f"   Content source: {prompt_result.get('content_source', 'unknown')}")
        
        # Step 2: Generate the hero image
        print(f"\n🚀 Step 2: Generating hero image for outline: {content_plan_outline_guid}")
        
        image_function_url = f"{SUPABASE_URL}/functions/v1/generate-hero-image"
        
        image_payload = {
            "guid": content_plan_outline_guid,
            "regenerate": False
        }
        
        image_response = requests.post(
            image_function_url,
            json=image_payload,
            headers=headers,
            timeout=timeout,
            verify=False
        )
        
        image_response.raise_for_status()
        image_result = image_response.json()
        
        if image_result.get('success'):
            print(f"✅ Hero image generated successfully!")
            print(f"   Image URL: {image_result.get('hero_image_url', 'N/A')}")
        
        return {
            "success": True,
            "prompt_result": prompt_result,
            "image_result": image_result,
            "hero_image_url": image_result.get('hero_image_url'),
            "hero_image_prompt_id": prompt_result.get('save_status', {}).get('hero_image_prompt_id')
        }
        
    except requests.exceptions.Timeout:
        return {
            "success": False,
            "error": f"Request timed out after {timeout} seconds"
        }
    except requests.exceptions.RequestException as e:
        return {
            "success": False,
            "error": str(e)
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }


# Example usage
if __name__ == "__main__":
    import asyncio
    
    # Replace with your actual content_plan_outline_guid
    OUTLINE_GUID = "your-content-plan-outline-guid-here"
    
    # Option 1: Async version (recommended)
    async def main():
        result = await generate_hero_image_from_unedited(OUTLINE_GUID)
        
        if result.get('success'):
            print(f"\n✅ All done!")
            print(f"   Hero Image URL: {result.get('hero_image_url')}")
        else:
            print(f"\n❌ Failed: {result.get('error')}")
    
    # Run async version
    # asyncio.run(main())
    
    # Option 2: Sync version
    # result = generate_hero_image_from_unedited_sync(OUTLINE_GUID)
    # if result.get('success'):
    #     print(f"\n✅ All done!")
    # else:
    #     print(f"\n❌ Failed: {result.get('error')}")

