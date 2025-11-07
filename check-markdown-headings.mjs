#!/usr/bin/env node

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jsypctdhynsdqrfifvdh.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const contentPlanOutlineGuid = 'fa4846f4-9391-4991-ba86-4717527e80b3';

const response = await fetch(`${SUPABASE_URL}/rest/v1/tasks?content_plan_outline_guid=eq.${contentPlanOutlineGuid}&select=unedited_content`, {
  headers: {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json'
  }
});

const taskData = await response.json();
const task = taskData[0];

if (!task.unedited_content) {
  console.error('❌ No unedited_content found');
  process.exit(1);
}

const markdown = task.unedited_content;

// Check for ### headings
const h3Matches = markdown.match(/^###\s+(.+)$/gm);
if (h3Matches) {
  console.log('\n=== Found ### Headings in Markdown ===');
  h3Matches.forEach((h3, i) => {
    const text = h3.replace(/^###\s+/, '');
    console.log(`${i + 1}. ${text}`);
  });
} else {
  console.log('\n❌ No ### headings found in markdown');
}

// Check for ## headings
const h2Matches = markdown.match(/^##\s+(.+)$/gm);
if (h2Matches) {
  console.log(`\n=== Found ${h2Matches.length} ## Headings in Markdown ===`);
  h2Matches.slice(0, 10).forEach((h2, i) => {
    const text = h2.replace(/^##\s+/, '');
    console.log(`${i + 1}. ${text}`);
  });
}
