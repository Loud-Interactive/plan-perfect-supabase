#!/usr/bin/env python3
"""
Monitor an existing PlanPerfect content job
Usage: python monitor-content-job.py <job_id>
"""

import os
import sys
import time
import requests
from pathlib import Path

# Load environment variables from .env file
try:
    from dotenv import load_dotenv
    env_path = Path(__file__).parent / '.env'
    load_dotenv(env_path)
except ImportError:
    pass  # dotenv optional

SUPABASE_URL = os.environ.get('SUPABASE_URL', 'https://jsypctdhynsdqrfifvdh.supabase.co')
SUPABASE_SERVICE_ROLE_KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY')

if not SUPABASE_SERVICE_ROLE_KEY:
    print("❌ Error: SUPABASE_SERVICE_ROLE_KEY not set")
    sys.exit(1)

def get_job_details(job_id):
    """Get full job details including stages"""
    print(f"\n📊 Job Details: {job_id}")
    print("=" * 60)
    
    # Get main job record
    url = f"{SUPABASE_URL}/rest/v1/content_jobs"
    headers = {
        'Authorization': f'Bearer {SUPABASE_SERVICE_ROLE_KEY}',
        'apikey': SUPABASE_SERVICE_ROLE_KEY
    }
    params = {'id': f'eq.{job_id}', 'select': '*'}
    
    response = requests.get(url, headers=headers, params=params)
    if response.status_code != 200:
        print(f"❌ Error getting job: {response.status_code}")
        return None
    
    jobs = response.json()
    if not jobs:
        print(f"❌ Job {job_id} not found")
        return None
    
    job = jobs[0]
    print(f"Type: {job.get('job_type')}")
    print(f"Status: {job.get('status')}")
    print(f"Current Stage: {job.get('stage')}")
    print(f"Priority: {job.get('priority')}")
    print(f"Created: {job.get('created_at')}")
    print(f"Updated: {job.get('updated_at')}")
    
    return job

def get_stage_progress(job_id):
    """Get progress of all stages"""
    print(f"\n🎯 Stage Progress:")
    print("=" * 60)
    
    url = f"{SUPABASE_URL}/rest/v1/content_job_stages"
    headers = {
        'Authorization': f'Bearer {SUPABASE_SERVICE_ROLE_KEY}',
        'apikey': SUPABASE_SERVICE_ROLE_KEY
    }
    params = {
        'job_id': f'eq.{job_id}',
        'select': '*',
        'order': 'stage'
    }
    
    response = requests.get(url, headers=headers, params=params)
    if response.status_code == 200:
        stages = response.json()
        if stages:
            for stage in stages:
                status_icon = {
                    'pending': '⏸️',
                    'queued': '⏳',
                    'processing': '⚙️',
                    'completed': '✅',
                    'failed': '❌'
                }.get(stage['status'], '❓')
                
                print(f"{status_icon} {stage['stage']:12} - {stage['status']:12} (attempt {stage['attempt_count']}/{stage['max_attempts']})")
                if stage.get('started_at'):
                    print(f"   Started: {stage['started_at']}")
                if stage.get('finished_at'):
                    print(f"   Finished: {stage['finished_at']}")
        else:
            print("No stage data yet")

def get_recent_events(job_id, limit=20):
    """Get recent events for job"""
    print(f"\n📜 Recent Events:")
    print("=" * 60)
    
    url = f"{SUPABASE_URL}/rest/v1/content_job_events"
    headers = {
        'Authorization': f'Bearer {SUPABASE_SERVICE_ROLE_KEY}',
        'apikey': SUPABASE_SERVICE_ROLE_KEY
    }
    params = {
        'job_id': f'eq.{job_id}',
        'select': '*',
        'order': 'created_at.desc',
        'limit': limit
    }
    
    response = requests.get(url, headers=headers, params=params)
    if response.status_code == 200:
        events = response.json()
        if events:
            for event in reversed(events[-10:]):  # Show last 10
                print(f"[{event['created_at']}]")
                stage = event.get('stage') or 'N/A'
                status = event.get('status') or 'N/A'
                message = event.get('message') or ''
                print(f"  Stage: {stage}, Status: {status}")
                print(f"  Message: {message}")
                if event.get('metadata'):
                    print(f"  Metadata: {event['metadata']}")
                print()
        else:
            print("No events yet")

def get_payloads(job_id):
    """Get stage payloads"""
    print(f"\n💾 Stage Payloads:")
    print("=" * 60)
    
    url = f"{SUPABASE_URL}/rest/v1/content_payloads"
    headers = {
        'Authorization': f'Bearer {SUPABASE_SERVICE_ROLE_KEY}',
        'apikey': SUPABASE_SERVICE_ROLE_KEY
    }
    params = {
        'job_id': f'eq.{job_id}',
        'select': 'stage,created_at,updated_at',
        'order': 'stage'
    }
    
    response = requests.get(url, headers=headers, params=params)
    if response.status_code == 200:
        payloads = response.json()
        if payloads:
            for payload in payloads:
                print(f"✅ {payload['stage']} - Updated: {payload['updated_at']}")
        else:
            print("No payloads yet")

def main():
    if len(sys.argv) < 2:
        print("Usage: python monitor-content-job.py <job_id>")
        print("\nExample:")
        print("  python monitor-content-job.py 123e4567-e89b-12d3-a456-426614174000")
        sys.exit(1)
    
    job_id = sys.argv[1]
    
    print("=" * 60)
    print("PlanPerfect Job Monitor")
    print("=" * 60)
    
    job = get_job_details(job_id)
    if not job:
        sys.exit(1)
    
    get_stage_progress(job_id)
    get_recent_events(job_id)
    get_payloads(job_id)
    
    print("\n" + "=" * 60)
    print("Monitor complete!")
    print("=" * 60)

if __name__ == '__main__':
    main()

