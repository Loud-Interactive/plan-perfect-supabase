#!/usr/bin/env node

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jsypctdhynsdqrfifvdh.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const contentPlanOutlineGuid = 'fa4846f4-9391-4991-ba86-4717527e80b3';

const response = await fetch(`${SUPABASE_URL}/rest/v1/tasks?content_plan_outline_guid=eq.${contentPlanOutlineGuid}&select=post_json`, {
  headers: {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json'
  }
});

const taskData = await response.json();
const task = taskData[0];

if (!task.post_json) {
  console.error('❌ No post_json found');
  process.exit(1);
}

const json = typeof task.post_json === 'string' ? JSON.parse(task.post_json) : task.post_json;

console.log('\n=== JSON Structure ===');
console.log('Title:', json.title);
console.log('Sections count:', json.sections?.length || 0);

if (json.sections) {
  json.sections.forEach((section, i) => {
    console.log(`\nSection ${i + 1}:`);
    console.log('  heading:', section.heading);
    console.log('  heading type:', typeof section.heading);
    console.log('  subsections count:', section.subsections?.length || 0);
    
    if (section.subsections) {
      section.subsections.forEach((sub, j) => {
        console.log(`  Subsection ${j + 1}:`);
        console.log('    heading:', sub.heading);
        console.log('    heading type:', typeof sub.heading);
        console.log('    content length:', sub.content?.length || 0);
      });
    }
  });
}
