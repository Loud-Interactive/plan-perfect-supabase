#!/usr/bin/env node
/**
 * Check status of tasks after HTML generation
 */

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jsypctdhynsdqrfifvdh.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_SERVICE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not found in environment');
  process.exit(1);
}

const taskIds = [
  '73b75fd0-60ba-4514-9b40-8ada11fe41c9',
  'dd36c10b-7c25-4022-8605-238b8a48ddde',
  '4ea2dee3-0c41-47bd-9ef6-668f48afbe22'
];

async function checkStatus() {
  console.log('🔍 Checking task statuses...\n');
  
  for (const taskId of taskIds) {
    try {
      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/tasks?task_id=eq.${taskId}&select=task_id,status,title,html_link,supabase_html_url,post_html`,
        {
          headers: {
            'apikey': SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      const data = await response.json();
      const task = data[0];
      
      if (task) {
        console.log(`📋 ${task.title}`);
        console.log(`   task_id: ${task.task_id}`);
        console.log(`   Status: ${task.status}`);
        console.log(`   HTML Link: ${task.html_link || 'N/A'}`);
        console.log(`   Supabase HTML URL: ${task.supabase_html_url || 'N/A'}`);
        console.log(`   Has post_html: ${task.post_html ? `Yes (${task.post_html.length} chars)` : 'No'}`);
        console.log('');
      } else {
        console.log(`❌ Task ${taskId} not found\n`);
      }
    } catch (error) {
      console.error(`❌ Error checking ${taskId}:`, error.message);
    }
  }
}

checkStatus().catch(console.error);

