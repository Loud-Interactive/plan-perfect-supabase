#!/usr/bin/env python3
"""
Python examples for calling generate-side-by-side edge function
Deployed with --no-verify-jwt, so no authentication required
"""

import requests
import json
import time
from typing import Optional, Dict, Any

# Configuration
SUPABASE_URL = "https://jsypctdhynsdqrfifvdh.supabase.co"
FUNCTION_URL = f"{SUPABASE_URL}/functions/v1/generate-side-by-side"

# Note: No API key needed because function is deployed with --no-verify-jwt


class GenerateSideBySide:
    """Client for calling the generate-side-by-side edge function"""
    
    def __init__(self, supabase_url: str = SUPABASE_URL):
        self.function_url = f"{supabase_url}/functions/v1/generate-side-by-side"
    
    def generate_html(
        self,
        task_id: str,
        timeout: int = 300  # 5 minutes default
    ) -> Dict[str, Any]:
        """
        Generate HTML from outline
        
        Args:
            task_id: The task UUID to process
            timeout: Request timeout in seconds (default 300)
        
        Returns:
            Dict containing the response
        """
        print(f"🚀 Generating HTML for task: {task_id}")
        
        payload = {
            "task_id": task_id
        }
        
        headers = {
            "Content-Type": "application/json"
        }
        
        try:
            response = requests.post(
                self.function_url,
                json=payload,
                headers=headers,
                timeout=timeout
            )
            
            # Check if request was successful
            response.raise_for_status()
            
            result = response.json()
            
            if result.get('success'):
                print(f"✅ HTML generation successful!")
                print(f"   Status: {result.get('status')}")
                print(f"   HTML Length: {len(result.get('html', ''))} chars")
                print(f"   Schema Generated: {result.get('schemaGenerated', False)}")
                return result
            else:
                print(f"❌ Generation failed: {result.get('error')}")
                return result
                
        except requests.exceptions.Timeout:
            print(f"⏰ Request timed out after {timeout} seconds")
            raise
        except requests.exceptions.RequestException as e:
            print(f"❌ Request failed: {e}")
            raise
    
    def generate_with_polling(
        self,
        task_id: str,
        poll_interval: int = 10,
        max_wait: int = 300
    ) -> Dict[str, Any]:
        """
        Generate HTML and poll for completion
        Useful for very long-running tasks
        
        Args:
            task_id: The task UUID to process
            poll_interval: Seconds between status checks
            max_wait: Maximum seconds to wait
        
        Returns:
            Dict containing the final result
        """
        print(f"🚀 Starting HTML generation for task: {task_id}")
        print(f"   Will poll every {poll_interval}s for up to {max_wait}s")
        
        # Start the generation (fire and forget)
        try:
            response = requests.post(
                self.function_url,
                json={"task_id": task_id},
                headers={"Content-Type": "application/json"},
                timeout=10  # Short timeout, just to start the job
            )
        except requests.exceptions.Timeout:
            print("⏰ Initial request timed out, but job may still be running...")
        
        # Poll for completion by checking task status
        # (You'll need a separate endpoint to check task status)
        start_time = time.time()
        
        while (time.time() - start_time) < max_wait:
            print(f"⏳ Polling... ({int(time.time() - start_time)}s elapsed)")
            
            # TODO: Add your status check logic here
            # For now, just wait
            time.sleep(poll_interval)
            
            # Check if task is complete
            # if task_complete:
            #     return result
        
        print(f"⏰ Timeout reached after {max_wait}s")
        return {"success": False, "error": "Polling timeout"}


# ============================================================================
# EXAMPLE 1: Simple synchronous call
# ============================================================================
def example_simple():
    """Simple example: Generate HTML from task"""
    print("\n" + "="*70)
    print("EXAMPLE 1: Simple Synchronous Call")
    print("="*70 + "\n")
    
    client = GenerateSideBySide()
    
    # Replace with your actual task ID
    task_id = "your-task-uuid-here"
    
    try:
        result = client.generate_html(task_id)
        
        if result.get('success'):
            print(f"\n✅ Success!")
            print(f"   HTML: {result.get('html', '')[:200]}...")
            print(f"   Schema: {json.dumps(result.get('schema'), indent=2)[:200]}...")
        else:
            print(f"\n❌ Failed: {result.get('error')}")
            
    except Exception as e:
        print(f"\n❌ Exception: {e}")


# ============================================================================
# EXAMPLE 2: Multiple tasks in sequence
# ============================================================================
def example_batch_sequential():
    """Process multiple tasks one at a time"""
    print("\n" + "="*70)
    print("EXAMPLE 2: Batch Processing (Sequential)")
    print("="*70 + "\n")
    
    client = GenerateSideBySide()
    
    task_ids = [
        "task-uuid-1",
        "task-uuid-2",
        "task-uuid-3"
    ]
    
    results = []
    
    for i, task_id in enumerate(task_ids, 1):
        print(f"\n📝 Processing task {i}/{len(task_ids)}: {task_id}")
        
        try:
            result = client.generate_html(task_id, timeout=300)
            results.append({
                "task_id": task_id,
                "success": result.get('success'),
                "error": result.get('error')
            })
            
            # Add delay between tasks to avoid rate limits
            if i < len(task_ids):
                time.sleep(2)
                
        except Exception as e:
            print(f"❌ Error processing {task_id}: {e}")
            results.append({
                "task_id": task_id,
                "success": False,
                "error": str(e)
            })
    
    # Summary
    print("\n" + "="*70)
    print("BATCH SUMMARY")
    print("="*70)
    successful = sum(1 for r in results if r['success'])
    print(f"✅ Successful: {successful}/{len(results)}")
    print(f"❌ Failed: {len(results) - successful}/{len(results)}")


# ============================================================================
# EXAMPLE 3: Parallel processing with threading
# ============================================================================
def example_batch_parallel():
    """Process multiple tasks in parallel"""
    print("\n" + "="*70)
    print("EXAMPLE 3: Batch Processing (Parallel)")
    print("="*70 + "\n")
    
    from concurrent.futures import ThreadPoolExecutor, as_completed
    
    client = GenerateSideBySide()
    
    task_ids = [
        "task-uuid-1",
        "task-uuid-2",
        "task-uuid-3",
        "task-uuid-4",
        "task-uuid-5"
    ]
    
    results = []
    
    # Process up to 3 tasks at once
    with ThreadPoolExecutor(max_workers=3) as executor:
        # Submit all tasks
        future_to_task = {
            executor.submit(client.generate_html, task_id): task_id
            for task_id in task_ids
        }
        
        # Process results as they complete
        for future in as_completed(future_to_task):
            task_id = future_to_task[future]
            
            try:
                result = future.result()
                results.append({
                    "task_id": task_id,
                    "success": result.get('success'),
                    "html_length": len(result.get('html', ''))
                })
                print(f"✅ Completed: {task_id}")
                
            except Exception as e:
                results.append({
                    "task_id": task_id,
                    "success": False,
                    "error": str(e)
                })
                print(f"❌ Failed: {task_id} - {e}")
    
    # Summary
    print("\n" + "="*70)
    print("PARALLEL BATCH SUMMARY")
    print("="*70)
    successful = sum(1 for r in results if r['success'])
    print(f"✅ Successful: {successful}/{len(results)}")
    print(f"❌ Failed: {len(results) - successful}/{len(results)}")


# ============================================================================
# EXAMPLE 4: Error handling and retries
# ============================================================================
def example_with_retries():
    """Example with automatic retry logic"""
    print("\n" + "="*70)
    print("EXAMPLE 4: With Retry Logic")
    print("="*70 + "\n")
    
    from time import sleep
    
    def generate_with_retry(
        task_id: str,
        max_retries: int = 3,
        retry_delay: int = 5
    ) -> Dict[str, Any]:
        """Generate HTML with automatic retries"""
        
        client = GenerateSideBySide()
        
        for attempt in range(1, max_retries + 1):
            print(f"\n🔄 Attempt {attempt}/{max_retries} for task: {task_id}")
            
            try:
                result = client.generate_html(task_id, timeout=300)
                
                if result.get('success'):
                    print(f"✅ Success on attempt {attempt}!")
                    return result
                else:
                    print(f"⚠️  Failed on attempt {attempt}: {result.get('error')}")
                    
                    if attempt < max_retries:
                        print(f"   Retrying in {retry_delay}s...")
                        sleep(retry_delay)
                    
            except requests.exceptions.Timeout:
                print(f"⏰ Timeout on attempt {attempt}")
                
                if attempt < max_retries:
                    print(f"   Retrying in {retry_delay}s...")
                    sleep(retry_delay)
                    
            except Exception as e:
                print(f"❌ Error on attempt {attempt}: {e}")
                
                if attempt < max_retries:
                    print(f"   Retrying in {retry_delay}s...")
                    sleep(retry_delay)
        
        return {"success": False, "error": f"Failed after {max_retries} attempts"}
    
    # Test it
    task_id = "your-task-uuid-here"
    result = generate_with_retry(task_id)
    
    if result.get('success'):
        print(f"\n🎉 Final result: Success!")
    else:
        print(f"\n❌ Final result: Failed - {result.get('error')}")


# ============================================================================
# EXAMPLE 5: Integration with database
# ============================================================================
def example_database_integration():
    """Example showing integration with Supabase database"""
    print("\n" + "="*70)
    print("EXAMPLE 5: Database Integration")
    print("="*70 + "\n")
    
    from supabase import create_client
    
    # Initialize Supabase client
    supabase = create_client(
        SUPABASE_URL,
        "your-service-role-key-here"
    )
    
    client = GenerateSideBySide()
    
    # Step 1: Get tasks that need HTML generation
    print("📋 Fetching tasks from database...")
    response = supabase.table('tasks') \
        .select('task_id, content_plan_outline_guid') \
        .eq('status', 'ready_for_generation') \
        .limit(10) \
        .execute()
    
    tasks = response.data
    print(f"   Found {len(tasks)} tasks to process")
    
    # Step 2: Process each task
    for task in tasks:
        task_id = task['task_id']
        outline_guid = task['content_plan_outline_guid']
        
        print(f"\n📝 Processing task: {task_id}")
        print(f"   Outline GUID: {outline_guid}")
        
        try:
            # Generate HTML
            result = client.generate_html(task_id)
            
            if result.get('success'):
                print(f"   ✅ HTML generated successfully")
                
                # Update task status in database
                supabase.table('tasks') \
                    .update({'status': 'html_generated'}) \
                    .eq('task_id', task_id) \
                    .execute()
                
                print(f"   ✅ Database updated")
            else:
                print(f"   ❌ Generation failed: {result.get('error')}")
                
                # Update task with error
                supabase.table('tasks') \
                    .update({
                        'status': 'generation_failed',
                        'message': result.get('error')
                    }) \
                    .eq('task_id', task_id) \
                    .execute()
                
        except Exception as e:
            print(f"   ❌ Exception: {e}")
            
            # Update task with error
            supabase.table('tasks') \
                .update({
                    'status': 'generation_failed',
                    'message': str(e)
                }) \
                .eq('task_id', task_id) \
                .execute()


# ============================================================================
# MAIN
# ============================================================================
if __name__ == "__main__":
    print("\n" + "="*70)
    print("GENERATE-SIDE-BY-SIDE PYTHON CLIENT EXAMPLES")
    print("="*70)
    print(f"\nFunction URL: {FUNCTION_URL}")
    print(f"Authentication: None (deployed with --no-verify-jwt)")
    print("\nNote: Replace task IDs with actual values before running!")
    
    # Uncomment the example you want to run:
    
    # example_simple()
    # example_batch_sequential()
    # example_batch_parallel()
    # example_with_retries()
    # example_database_integration()
    
    print("\n" + "="*70)
    print("Examples complete!")
    print("="*70 + "\n")

