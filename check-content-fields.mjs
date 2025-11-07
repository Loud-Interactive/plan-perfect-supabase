#!/usr/bin/env node

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jsypctdhynsdqrfifvdh.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const contentPlanOutlineGuid = 'fa4846f4-9391-4991-ba86-4717527e80b3';

const response = await fetch(`${SUPABASE_URL}/rest/v1/tasks?content_plan_outline_guid=eq.${contentPlanOutlineGuid}&select=*`, {
  headers: {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json'
  }
});

const taskData = await response.json();
const task = taskData[0];

console.log('\n=== Available Content Fields ===');
const contentFields = ['unedited_content', 'edited_content', 'content', 'post_html', 'post_json'];
contentFields.forEach(field => {
  const value = task[field];
  if (value) {
    console.log(`✅ ${field}: ${typeof value === 'string' ? value.length + ' chars' : 'object'}`);
  } else {
    console.log(`❌ ${field}: not set`);
  }
});
