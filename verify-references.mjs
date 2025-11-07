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

// Find the references section
const referencesMatch = html.match(/<div id="references">[\s\S]*?<\/div>/);
if (referencesMatch) {
  const referencesSection = referencesMatch[0];
  
  // Extract all reference links
  const linkMatches = referencesSection.match(/<a href="([^"]+)">([^<]+)<\/a>/g);
  if (linkMatches) {
    console.log(`\n✅ Found ${linkMatches.length} reference links:\n`);
    linkMatches.slice(0, 5).forEach((link, i) => {
      const hrefMatch = link.match(/href="([^"]+)"/);
      const textMatch = link.match(/>([^<]+)</);
      const href = hrefMatch ? hrefMatch[1] : 'N/A';
      const text = textMatch ? textMatch[1] : 'N/A';
      console.log(`${i + 1}. URL: ${href}`);
      console.log(`   Anchor text: ${text}`);
      console.log(`   ${href === text ? '✅' : '❌'} URL matches anchor text\n`);
    });
  }
} else {
  console.log('\n❌ References section not found');
}
