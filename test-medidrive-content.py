#!/usr/bin/env python3
"""
Test PlanPerfect Content Generation for Medidrive.com
Based on LSI keyword research for "non emergency ambulance"
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
    print(f"✅ Loaded environment from {env_path}")
except ImportError:
    print("⚠️  python-dotenv not installed. Install with: pip install python-dotenv")
    print("   Or export SUPABASE_SERVICE_ROLE_KEY manually")

# Configuration
SUPABASE_URL = os.environ.get('SUPABASE_URL', 'https://jsypctdhynsdqrfifvdh.supabase.co')
SUPABASE_SERVICE_ROLE_KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY')

if not SUPABASE_SERVICE_ROLE_KEY:
    print("❌ Error: SUPABASE_SERVICE_ROLE_KEY environment variable not set")
    print("Set it with: export SUPABASE_SERVICE_ROLE_KEY='your-key-here'")
    sys.exit(1)

# Medidrive.com content job payload based on LSI research
MEDIDRIVE_JOB = {
    "job_type": "article",
    "requester_email": "martin@loud.us",
    "payload": {
        "title": "Complete Guide to Non-Emergency Ambulance Services: When and How to Use Medical Transport",
        "domain": "medidrive.com",
        "keywords": [
            "non emergency ambulance",              # Primary keyword
            "non urgent ambulance service",         # LSI keyword 1
            "medical patient transport",            # LSI keyword 2
            "ambulance transfer for non emergencies" # LSI keyword 3
        ],
        "primary_keyword": "non emergency ambulance",
        "target_audience": "Patients and family members who need non-emergency medical transportation",
        "tone": "professional, informative, and reassuring",
        "content_type": "comprehensive guide"
    },
    "initial_stage": "research"
}

def submit_job():
    """Submit content generation job to content-intake"""
    print("\n🚀 Submitting Medidrive.com Content Job")
    print("=" * 70)
    print(f"📝 Title: {MEDIDRIVE_JOB['payload']['title']}")
    print(f"🔑 Primary Keyword: {MEDIDRIVE_JOB['payload']['primary_keyword']}")
    print(f"📊 LSI Keywords: {len(MEDIDRIVE_JOB['payload']['keywords']) - 1}")
    for i, kw in enumerate(MEDIDRIVE_JOB['payload']['keywords'][1:], 1):
        print(f"   {i}. {kw}")
    print(f"🌐 Domain: {MEDIDRIVE_JOB['payload']['domain']}")
    print(f"📧 Requester: {MEDIDRIVE_JOB['requester_email']}")
    print("=" * 70)
    
    url = f"{SUPABASE_URL}/functions/v1/content-intake"
    headers = {
        'Authorization': f'Bearer {SUPABASE_SERVICE_ROLE_KEY}',
        'Content-Type': 'application/json'
    }
    
    print(f"\n🌐 Endpoint: {url}")
    print("📤 Sending request...")
    
    try:
        response = requests.post(url, json=MEDIDRIVE_JOB, headers=headers, timeout=30)
        
        print(f"📥 Response Status: {response.status_code}")
        
        # Accept both 200 (OK) and 202 (Accepted) as success
        if response.status_code in [200, 202]:
            data = response.json()
            job_id = data.get('job_id')
            
            print("\n" + "=" * 70)
            print("✅ JOB SUBMITTED SUCCESSFULLY!")
            print("=" * 70)
            print(f"📋 Job ID: {job_id}")
            print(f"📊 Status: {data.get('status')}")
            print(f"🎯 Stage: {data.get('stage')}")
            print(f"⏰ Submitted: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
            print("=" * 70)
            
            return job_id
        else:
            print(f"\n❌ ERROR: {response.status_code}")
            print(f"Response: {response.text}")
            return None
            
    except requests.exceptions.RequestException as e:
        print(f"\n❌ Request failed: {e}")
        return None

def check_job_status(job_id):
    """Check job status from database"""
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
                print(f"\n📊 Current Status:")
                print(f"   Status: {job.get('status')}")
                print(f"   Stage: {job.get('stage')}")
                print(f"   Priority: {job.get('priority')}")
                print(f"   Updated: {job.get('updated_at')}")
                return job
        else:
            print(f"❌ Error checking status: {response.status_code}")
    except Exception as e:
        print(f"❌ Error: {e}")
    
    return None

def check_stage_progress(job_id):
    """Check stage progress"""
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
    
    try:
        response = requests.get(url, headers=headers, params=params, timeout=10)
        if response.status_code == 200:
            stages = response.json()
            if stages:
                print(f"\n🎯 Stage Progress:")
                for stage in stages:
                    status_icon = {
                        'pending': '⏸️',
                        'queued': '⏳',
                        'processing': '⚙️',
                        'completed': '✅',
                        'failed': '❌'
                    }.get(stage['status'], '❓')
                    
                    print(f"   {status_icon} {stage['stage']:12} - {stage['status']:12} (attempt {stage['attempt_count']}/{stage['max_attempts']})")
    except Exception as e:
        print(f"❌ Error checking stages: {e}")

def check_events(job_id, limit=10):
    """Check recent job events"""
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
                print(f"\n📜 Recent Events (last {min(len(events), limit)}):")
                for event in reversed(events[-5:]):  # Show last 5
                    timestamp = event['created_at'].split('T')[1][:8]
                    print(f"   [{timestamp}] {event['stage']:12} - {event['status']:10} - {event['message']}")
    except Exception as e:
        print(f"❌ Error checking events: {e}")

def monitor_job(job_id, duration=180, interval=10):
    """Monitor job for specified duration"""
    print(f"\n👀 Monitoring job for {duration} seconds...")
    print("=" * 70)
    print("Press Ctrl+C to stop\n")
    
    start_time = time.time()
    last_status = None
    
    try:
        while time.time() - start_time < duration:
            job = check_job_status(job_id)
            
            if job:
                current_status = f"{job.get('status')}:{job.get('stage')}"
                
                # Only show updates when status changes
                if current_status != last_status:
                    check_stage_progress(job_id)
                    check_events(job_id)
                    print()
                    last_status = current_status
                
                # Check if completed
                if job.get('status') in ['completed', 'failed']:
                    print("\n" + "=" * 70)
                    if job.get('status') == 'completed':
                        print("✅ JOB COMPLETED!")
                    else:
                        print("❌ JOB FAILED!")
                    print("=" * 70)
                    check_stage_progress(job_id)
                    check_events(job_id)
                    return
            
            time.sleep(interval)
        
        print(f"\n⏰ Monitoring time expired ({duration}s)")
        print("Job may still be processing. Check status manually:")
        print(f"  SELECT * FROM content_jobs WHERE id = '{job_id}';")
        
    except KeyboardInterrupt:
        print("\n\n⏸️  Monitoring stopped by user")
        print(f"Job ID: {job_id}")

def main():
    print("\n" + "=" * 70)
    print("🏥 MEDIDRIVE.COM - CONTENT GENERATION TEST")
    print("=" * 70)
    print("\nKeyword Strategy:")
    print("  Primary: non emergency ambulance")
    print("  LSI Expansion: 3 related keywords")
    print("  Expected Research: 4 keywords → 30-40 SERP results")
    print("=" * 70)
    
    # Submit job
    job_id = submit_job()
    
    if not job_id:
        print("\n❌ Failed to submit job. Exiting.")
        sys.exit(1)
    
    # Initial wait for queue processing
    print("\n⏳ Waiting for initial processing...")
    time.sleep(3)
    
    # Check initial status
    check_job_status(job_id)
    check_stage_progress(job_id)
    check_events(job_id)
    
    # Ask about monitoring
    print("\n" + "=" * 70)
    response = input("\nMonitor this job? (y/n): ")
    
    if response.lower() == 'y':
        monitor_job(job_id, duration=300, interval=15)  # 5 minutes, check every 15s
    else:
        print(f"\n📋 Job ID for later reference: {job_id}")
        print("\nTo check status later:")
        print(f"  python monitor-content-job.py {job_id}")
        print("\nOr via SQL:")
        print(f"  SELECT * FROM content_jobs WHERE id = '{job_id}';")
        print(f"  SELECT * FROM content_job_events WHERE job_id = '{job_id}' ORDER BY created_at;")

if __name__ == '__main__':
    main()

