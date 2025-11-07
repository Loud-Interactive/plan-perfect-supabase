"""
Helper function to generate hero image from unedited_content
Add this to your existing Python codebase
"""

import httpx
from typing import Optional, Dict, Any


async def generate_hero_image_from_unedited_content(
    content_plan_outline_guid: str,
    supabase_url: str,
    supabase_service_key: Optional[str] = None,
    timeout: float = 300.0
) -> Dict[str, Any]:
    """
    Generate hero image prompt from unedited_content, then generate the hero image.
    
    Args:
        content_plan_outline_guid: The content plan outline GUID to process
        supabase_url: Your Supabase project URL
        supabase_service_key: Optional service role key (if functions require auth)
        timeout: Request timeout in seconds
        
    Returns:
        dict with success, prompt_result, image_result, hero_image_url, error
    """
    headers = {
        "Content-Type": "application/json"
    }
    
    if supabase_service_key:
        headers["Authorization"] = f"Bearer {supabase_service_key}"
    
    async with httpx.AsyncClient(timeout=timeout, verify=False) as client:
        # Step 1: Generate prompt from unedited_content
        prompt_response = await client.post(
            f"{supabase_url}/functions/v1/generate-hero-image-prompt",
            json={
                "content_plan_outline_guid": content_plan_outline_guid,
                "use_unedited_content": True
            },
            headers=headers
        )
        
        if prompt_response.status_code != 200:
            return {
                "success": False,
                "error": f"Prompt generation failed: HTTP {prompt_response.status_code}",
                "details": prompt_response.text[:500]
            }
        
        prompt_result = prompt_response.json()
        
        # Step 2: Generate the hero image
        image_response = await client.post(
            f"{supabase_url}/functions/v1/generate-hero-image",
            json={
                "guid": content_plan_outline_guid,
                "regenerate": False
            },
            headers=headers
        )
        
        if image_response.status_code != 200:
            return {
                "success": False,
                "error": f"Image generation failed: HTTP {image_response.status_code}",
                "details": image_response.text[:500],
                "prompt_result": prompt_result
            }
        
        image_result = image_response.json()
        
        return {
            "success": True,
            "prompt_result": prompt_result,
            "image_result": image_result,
            "hero_image_url": image_result.get('hero_image_url'),
            "hero_image_prompt_id": prompt_result.get('save_status', {}).get('hero_image_prompt_id')
        }


# Usage example in your existing code:
"""
# In your existing async function:
edge_result = await generate_html_from_edge_function(
    prompt_request.content_plan_outline_guid
)

if edge_result and edge_result.get('success'):
    article = edge_result.get('html', '')
    print(f"✅ HTML generated successfully ({len(article)} chars)")
    
    # Generate hero image from unedited_content
    hero_result = await generate_hero_image_from_unedited_content(
        content_plan_outline_guid=prompt_request.content_plan_outline_guid,
        supabase_url=SUPABASE_URL,
        supabase_service_key=SUPABASE_SERVICE_ROLE_KEY
    )
    
    if hero_result.get('success'):
        print(f"✅ Hero image generated: {hero_result.get('hero_image_url')}")
    else:
        print(f"⚠️  Hero image generation failed: {hero_result.get('error')}")
"""

