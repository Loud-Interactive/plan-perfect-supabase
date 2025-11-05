#!/usr/bin/env node

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jsypctdhynsdqrfifvdh.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not found in environment');
  console.error('Please set it in your .env file or export it');
  process.exit(1);
}

const contentPlanOutlineGuid = '79b208ae-1973-4a5b-b940-0971c6be396f';

// First, check the task data
console.log(`\n🔍 Checking task data for content_plan_outline_guid: ${contentPlanOutlineGuid}\n`);

const checkResponse = await fetch(`${SUPABASE_URL}/rest/v1/tasks?content_plan_outline_guid=eq.${contentPlanOutlineGuid}&select=task_id,google_doc_link,title,edited_content`, {
  headers: {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json'
  }
});

const taskData = await checkResponse.json();

if (taskData.length === 0) {
  console.error('❌ No task found with that content_plan_outline_guid');
  process.exit(1);
}

const task = taskData[0];
console.log(`✅ Found task:`);
console.log(`   Task ID: ${task.task_id}`);
console.log(`   Title: ${task.title || 'N/A'}`);
console.log(`   Google Doc Link: ${task.google_doc_link || 'NOT SET'}`);
console.log(`   Has edited_content: ${task.edited_content ? 'Yes (' + task.edited_content.length + ' chars)' : 'No'}`);

if (!task.google_doc_link) {
  console.error('\n❌ This task does not have a google_doc_link set');
  process.exit(1);
}

console.log(`\n🚀 Calling google-doc-to-markdown function...\n`);

const functionResponse = await fetch(`${SUPABASE_URL}/functions/v1/google-doc-to-markdown`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
  },
  body: JSON.stringify({
    content_plan_outline_guid: contentPlanOutlineGuid
  })
});

const responseText = await functionResponse.text();
console.log(`Status: ${functionResponse.status} ${functionResponse.statusText}`);

try {
  const result = JSON.parse(responseText);
  console.log('\n✅ Response:');
  console.log(JSON.stringify(result, null, 2));
  
  if (result.success) {
    console.log('\n✅ Success! The task has been updated with markdown and JSON.');
  }
} catch (e) {
  console.log('\n⚠️  Response (not JSON):');
  console.log(responseText);
}
