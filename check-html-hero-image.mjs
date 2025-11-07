#!/usr/bin/env node

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jsypctdhynsdqrfifvdh.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const contentPlanOutlineGuid = 'fa4846f4-9391-4991-ba86-4717527e80b3';

console.log(`\n🔍 Checking HTML for hero image usage\n`);

// Get the HTML link
const response = await fetch(`${SUPABASE_URL}/rest/v1/tasks?content_plan_outline_guid=eq.${contentPlanOutlineGuid}&select=html_link,hero_image_url`, {
  headers: {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json'
  }
});

const taskData = await response.json();
const task = taskData[0];

// Fetch the HTML content
const htmlResponse = await fetch(task.html_link);
const htmlContent = await htmlResponse.text();

console.log(`📄 HTML Length: ${htmlContent.length} characters`);
console.log(`🖼️  Hero Image URL: ${task.hero_image_url}\n`);

// Check multiple places where hero image might appear
const checks = {
  'In JSON-LD schema': htmlContent.includes(`"image": "${task.hero_image_url}"`),
  'In LEAD_IMAGE_URL placeholder': htmlContent.includes(`LEAD_IMAGE_URL`) && htmlContent.includes(task.hero_image_url),
  'In img src attribute': htmlContent.includes(`<img`) && htmlContent.includes(task.hero_image_url),
  'In meta og:image': htmlContent.includes(`og:image`) && htmlContent.includes(task.hero_image_url),
};

console.log('✅ Hero image usage in HTML:');
Object.entries(checks).forEach(([location, found]) => {
  console.log(`   ${found ? '✅' : '❌'} ${location}: ${found ? 'Found' : 'Not found'}`);
});

// Show a sample of where it appears
if (htmlContent.includes(task.hero_image_url)) {
  const index = htmlContent.indexOf(task.hero_image_url);
  const before = htmlContent.substring(Math.max(0, index - 150), index);
  const after = htmlContent.substring(index + task.hero_image_url.length, Math.min(htmlContent.length, index + task.hero_image_url.length + 150));
  console.log(`\n📝 Sample context:`);
  console.log(`...${before.substring(before.length - 100)}[HERO_IMAGE_URL]${after.substring(0, 100)}...`);
}
