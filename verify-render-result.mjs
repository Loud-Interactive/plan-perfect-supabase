#!/usr/bin/env node

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jsypctdhynsdqrfifvdh.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const contentPlanOutlineGuid = 'fa4846f4-9391-4991-ba86-4717527e80b3';

console.log(`\n🔍 Verifying saved data for content_plan_outline_guid: ${contentPlanOutlineGuid}\n`);

const response = await fetch(`${SUPABASE_URL}/rest/v1/tasks?content_plan_outline_guid=eq.${contentPlanOutlineGuid}&select=task_id,title,html_link,content,status,hero_image_url`, {
  headers: {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json'
  }
});

const taskData = await response.json();

if (taskData.length === 0) {
  console.error('❌ No task found with that content_plan_outline_guid');
  process.exit(1);
}

const task = taskData[0];
console.log(`✅ Task ID: ${task.task_id}`);
console.log(`✅ Title: ${task.title}`);
console.log(`\n📝 Status: ${task.status || 'N/A'}`);
console.log(`\n🔗 HTML Link: ${task.html_link || 'NOT SET'}`);
console.log(`\n📄 Content: ${task.content ? 'Yes (' + task.content.length + ' chars)' : 'NOT SET'}`);
console.log(`\n🖼️  Hero Image URL: ${task.hero_image_url || 'NOT SET'}`);

if (task.html_link && task.hero_image_url) {
  console.log(`\n✅ Success! Both HTML and hero image have been generated and saved.`);
  console.log(`   HTML: ${task.html_link}`);
  console.log(`   Hero Image: ${task.hero_image_url}`);
}
