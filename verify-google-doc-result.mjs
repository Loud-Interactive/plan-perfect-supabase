#!/usr/bin/env node

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jsypctdhynsdqrfifvdh.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const contentPlanOutlineGuid = '79b208ae-1973-4a5b-b940-0971c6be396f';

console.log(`\n🔍 Verifying saved data for content_plan_outline_guid: ${contentPlanOutlineGuid}\n`);

const response = await fetch(`${SUPABASE_URL}/rest/v1/tasks?content_plan_outline_guid=eq.${contentPlanOutlineGuid}&select=task_id,title,edited_content,post_json`, {
  headers: {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json'
  }
});

const taskData = await response.json();

if (taskData.length === 0) {
  console.error('❌ No task found');
  process.exit(1);
}

const task = taskData[0];
console.log(`✅ Task ID: ${task.task_id}`);
console.log(`✅ Title: ${task.title}`);
console.log(`\n📝 Edited Content (markdown):`);
console.log(`   Length: ${task.edited_content ? task.edited_content.length : 0} characters`);
console.log(`   Preview (first 500 chars):`);
console.log(`   ${task.edited_content ? task.edited_content.substring(0, 500) + '...' : 'NOT SET'}`);

console.log(`\n📊 Post JSON:`);
if (task.post_json) {
  console.log(`   Title: ${task.post_json.title || 'N/A'}`);
  console.log(`   Sections: ${task.post_json.sections ? task.post_json.sections.length : 0}`);
  console.log(`   References: ${task.post_json.references ? task.post_json.references.length : 0}`);
  console.log(`\n   Full JSON structure:`);
  console.log(JSON.stringify(task.post_json, null, 2).substring(0, 1000) + '...');
} else {
  console.log('   NOT SET');
}
