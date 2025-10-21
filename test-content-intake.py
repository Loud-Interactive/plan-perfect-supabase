#!/usr/bin/env python3
"""
Test script for PlanPerfect Content Generation System
Submits a test job to content-intake and monitors progress
"""

import os
import sys
import time
import requests
from datetime import datetime
from pathlib import Path

# Load environment variables from .env file
try:
    from dotenv import load_dotenv
    env_path = Path(__file__).parent / '.env'
    load_dotenv(env_path)
except ImportError:
    pass  # dotenv optional

# Configuration
SUPABASE_URL = os.environ.get('SUPABASE_URL', 'https://jsypctdhynsdqrfifvdh.supabase.co')
SUPABASE_SERVICE_ROLE_KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
SUPABASE_ANON_KEY = os.environ.get('SUPABASE_ANON_KEY')

if not SUPABASE_SERVICE_ROLE_KEY:
    print("❌ Error: SUPABASE_SERVICE_ROLE_KEY environment variable not set")
    print("Set it with: export SUPABASE_SERVICE_ROLE_KEY='your-key-here'")
    sys.exit(1)

# Test job payload
TEST_JOB = {
    "job_type": "article",
    "requester_email": "test@example.com",
    "payload": {
        "title": "Test Article: Benefits of AI in Content Marketing",
        "keywords": ["AI content marketing", "automated content", "content generation"],
        "domain": "example.com",
        "target_audience": "marketing professionals",
        "tone": "professional yet conversational"
    },
    "initial_stage": "research"
}

def submit_job():
    """Submit a test job to content-intake"""
    print("\n🚀 Submitting test job to content-intake...")
    print(f"📝 Job type: {TEST_JOB['job_type']}")
    print(f"📝 Title: {TEST_JOB['payload']['title']}")
    
    url = f"{SUPABASE_URL}/functions/v1/content-intake"
    headers = {
        'Authorization': f'Bearer {SUPABASE_SERVICE_ROLE_KEY}',
        'Content-Type': 'application/json'
    }
    
    try:
        response = requests.post(url, json=TEST_JOB, headers=headers, timeout=30)
        
        # Accept both 200 (OK) and 202 (Accepted) as success
        if response.status_code in [200, 202]:
            data = response.json()
            job_id = data.get('job_id')
            print(f"✅ Job submitted successfully!")
            print(f"📋 Job ID: {job_id}")
            print(f"📊 Status: {data.get('status')}")
            print(f"🎯 Stage: {data.get('stage')}")
            return job_id
        else:
            print(f"❌ Error: {response.status_code}")
            print(f"Response: {response.text}")
            return None
            
    except requests.exceptions.RequestException as e:
        print(f"❌ Request failed: {e}")
        return None

def check_job_status(job_id):
    """Check job status from database"""
    print(f"\n📊 Checking status for job {job_id}...")
    
    url = f"{SUPABASE_URL}/rest/v1/content_jobs"
    headers = {
        'Authorization': f'Bearer {SUPABASE_SERVICE_ROLE_KEY}',
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Content-Type': 'application/json'
    }
    params = {
        'id': f'eq.{job_id}',
        'select': '*'
    }
    
    try:
        response = requests.get(url, headers=headers, params=params, timeout=10)
        if response.status_code == 200:
            jobs = response.json()
            if jobs:
                job = jobs[0]
                print(f"Status: {job.get('status')}")
                print(f"Stage: {job.get('stage')}")
                print(f"Created: {job.get('created_at')}")
                print(f"Updated: {job.get('updated_at')}")
                return job
        else:
            print(f"❌ Error: {response.status_code} - {response.text}")
    except Exception as e:
        print(f"❌ Error checking status: {e}")
    
    return None

def check_job_events(job_id, limit=10):
    """Check job events"""
    print(f"\n📜 Recent events for job {job_id}...")
    
    url = f"{SUPABASE_URL}/rest/v1/content_job_events"
    headers = {
        'Authorization': f'Bearer {SUPABASE_SERVICE_ROLE_KEY}',
        'apikey': SUPABASE_SERVICE_ROLE_KEY
    }
    params = {
        'job_id': f'eq.{job_id}',
        'select': 'stage,status,message,created_at',
        'order': 'created_at.desc',
        'limit': limit
    }
    
    try:
        response = requests.get(url, headers=headers, params=params, timeout=10)
        if response.status_code == 200:
            events = response.json()
            if events:
                for event in reversed(events):
                    print(f"  [{event['created_at']}] {event['stage']}: {event['status']} - {event['message']}")
            else:
                print("  No events yet")
        else:
            print(f"❌ Error: {response.status_code}")
    except Exception as e:
        print(f"❌ Error: {e}")

def check_stage_backlog():
    """Check queue backlog by stage"""
    print(f"\n📊 Checking stage backlog...")
    
    url = f"{SUPABASE_URL}/rest/v1/rpc/get_content_stage_backlog"
    headers = {
        'Authorization': f'Bearer {SUPABASE_SERVICE_ROLE_KEY}',
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Content-Type': 'application/json'
    }
    
    try:
        response = requests.post(url, headers=headers, json={}, timeout=10)
        if response.status_code == 200:
            backlog = response.json()
            if backlog:
                print("\nStage Backlog:")
                for item in backlog:
                    print(f"  {item['stage']}: {item['ready_count']} ready, {item['inflight_count']} in-flight")
            else:
                print("  No backlog data")
        else:
            print(f"❌ Error: {response.status_code} - {response.text}")
    except Exception as e:
        print(f"❌ Error: {e}")

def monitor_job(job_id, duration=60, interval=5):
    """Monitor job progress for a specified duration"""
    print(f"\n👀 Monitoring job for {duration} seconds (checking every {interval}s)...")
    print("Press Ctrl+C to stop monitoring\n")
    
    start_time = time.time()
    try:
        while time.time() - start_time < duration:
            job = check_job_status(job_id)
            if job:
                status = job.get('status')
                if status in ['completed', 'failed']:
                    print(f"\n✅ Job finished with status: {status}")
                    check_job_events(job_id)
                    return
            
            time.sleep(interval)
        
        print(f"\n⏰ Monitoring time expired. Job may still be processing.")
        print("Check status manually or run this script again with the job ID.")
        
    except KeyboardInterrupt:
        print("\n⏸️  Monitoring stopped by user")

def main():
    """Main test flow"""
    print("=" * 60)
    print("PlanPerfect Content Generation System - Test Script")
    print("=" * 60)
    
    # Check stage backlog first
    check_stage_backlog()
    
    # Submit job
    job_id = submit_job()
    
    if not job_id:
        print("\n❌ Failed to submit job. Exiting.")
        sys.exit(1)
    
    # Wait a moment for intake to process
    time.sleep(2)
    
    # Check initial status
    check_job_status(job_id)
    check_job_events(job_id)
    
    # Ask if user wants to monitor
    print("\n" + "=" * 60)
    response = input("Do you want to monitor this job? (y/n): ")
    
    if response.lower() == 'y':
        monitor_job(job_id, duration=300, interval=10)
    else:
        print(f"\n📋 Job ID: {job_id}")
        print("You can check status later with:")
        print(f"  SELECT * FROM content_jobs WHERE id = '{job_id}';")
        print(f"  SELECT * FROM content_job_events WHERE job_id = '{job_id}' ORDER BY created_at;")

if __name__ == '__main__':
    main()

