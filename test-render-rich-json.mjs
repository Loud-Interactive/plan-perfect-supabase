#!/usr/bin/env node

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jsypctdhynsdqrfifvdh.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not found in environment');
  process.exit(1);
}

const contentPlanOutlineGuid = 'fa4846f4-9391-4991-ba86-4717527e80b3';

console.log(`\n🚀 Calling render-rich-json-to-html for content_plan_outline_guid: ${contentPlanOutlineGuid}\n`);

const response = await fetch(`${SUPABASE_URL}/functions/v1/render-rich-json-to-html`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
  },
  body: JSON.stringify({
    content_plan_outline_guid: contentPlanOutlineGuid
  })
});

const responseText = await response.text();
console.log(`Status: ${response.status} ${response.statusText}`);

try {
  const result = JSON.parse(responseText);
  console.log('\n✅ Response:');
  console.log(JSON.stringify(result, null, 2));
  
  if (result.success || result.html_link) {
    console.log('\n✅ Success! HTML generated.');
    if (result.html_link) {
      console.log(`📄 HTML Link: ${result.html_link}`);
    }
  }
} catch (e) {
  console.log('\n⚠️  Response (not JSON):');
  console.log(responseText.substring(0, 500));
}
