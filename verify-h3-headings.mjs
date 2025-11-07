#!/usr/bin/env node

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jsypctdhynsdqrfifvdh.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const contentPlanOutlineGuid = 'fa4846f4-9391-4991-ba86-4717527e80b3';

const response = await fetch(`${SUPABASE_URL}/rest/v1/tasks?content_plan_outline_guid=eq.${contentPlanOutlineGuid}&select=html_link`, {
  headers: {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json'
  }
});

const taskData = await response.json();
const task = taskData[0];

if (!task.html_link) {
  console.error('❌ No html_link found');
  process.exit(1);
}

// Fetch the HTML
const htmlResponse = await fetch(task.html_link);
const html = await htmlResponse.text();

// Find all H3 headings
const h3Matches = html.match(/<h3[^>]*>(.*?)<\/h3>/g);
if (h3Matches) {
  console.log(`\n✅ Found ${h3Matches.length} H3 headings in HTML:\n`);
  h3Matches.slice(0, 15).forEach((h3, i) => {
    const text = h3.replace(/<[^>]*>/g, '').trim();
    console.log(`${i + 1}. ${text}`);
  });
  
  // Check for "undefined"
  const undefinedMatches = html.match(/<h3[^>]*>undefined<\/h3>/g);
  if (undefinedMatches) {
    console.log(`\n❌ Found ${undefinedMatches.length} H3 headings with "undefined"`);
  } else {
    console.log(`\n✅ No "undefined" headings found - all H3 headings are correct!`);
  }
} else {
  console.log('\n❌ No H3 headings found in HTML');
}
