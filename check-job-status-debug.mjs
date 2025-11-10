#!/usr/bin/env node
/**
 * Check status of a specific outline regeneration job
 * Usage: node check-job-status.mjs <content_plan_outline_guid>
 */

const jobGuid = process.argv[2] || '0d2b04be-4c98-4bcc-9aef-82a4c23f21ac';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jsypctdhynsdqrfifvdh.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_SERVICE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not found in environment');
  process.exit(1);
}

async function checkJobStatus(guid) {
  console.log(`\n🔍 Checking status for job: ${guid}\n`);

  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/check_job_status`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'apikey': SUPABASE_SERVICE_KEY
    },
    body: JSON.stringify({ job_guid: guid })
  });

  if (!response.ok) {
    // Try direct queries instead
    console.log('📊 Checking outline_generation_jobs table...');
    const jobsResponse = await fetch(`${SUPABASE_URL}/rest/v1/outline_generation_jobs?id=eq.${guid}&select=*`, {
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'apikey': SUPABASE_SERVICE_KEY
      }
    });
    
    if (jobsResponse.ok) {
      const jobs = await jobsResponse.json();
      console.log('Job data:', JSON.stringify(jobs, null, 2));
    }

    console.log('\n📊 Checking content_plan_outlines table...');
    const outlinesResponse = await fetch(`${SUPABASE_URL}/rest/v1/content_plan_outlines?guid=eq.${guid}&select=*`, {
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'apikey': SUPABASE_SERVICE_KEY
      }
    });
    
    if (outlinesResponse.ok) {
      const outlines = await outlinesResponse.json();
      console.log('Outline data:', JSON.stringify(outlines, null, 2));
    }

    console.log('\n📊 Checking content_plan_outline_statuses table...');
    const statusesResponse = await fetch(`${SUPABASE_URL}/rest/v1/content_plan_outline_statuses?outline_guid=eq.${guid}&select=*&order=created_at.desc&limit=20`, {
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'apikey': SUPABASE_SERVICE_KEY
      }
    });
    
    if (statusesResponse.ok) {
      const statuses = await statusesResponse.json();
      console.log('\n📋 Recent Status Updates:');
      statuses.forEach((status, idx) => {
        console.log(`  ${idx + 1}. [${status.created_at}] ${status.status}`);
      });
    }

    return;
  }

  const data = await response.json();
  console.log(JSON.stringify(data, null, 2));
}

checkJobStatus(jobGuid).catch(console.error);

