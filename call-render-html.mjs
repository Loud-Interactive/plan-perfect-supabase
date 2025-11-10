#!/usr/bin/env node
/**
 * Call render-rich-json-to-html for a specific content_plan_outline_guid
 */

const contentPlanOutlineGuid = process.argv[2] || 'd7201503-78be-44f6-bc5d-50d24ab12ee4';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jsypctdhynsdqrfifvdh.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_SERVICE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not found in environment');
  process.exit(1);
}

async function renderHTML() {
  console.log(`🚀 Calling render-rich-json-to-html for content_plan_outline_guid: ${contentPlanOutlineGuid}\n`);
  
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/render-rich-json-to-html`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
      },
      body: JSON.stringify({
        content_plan_outline_guid: contentPlanOutlineGuid
      })
    });

    console.log(`📊 Response Status: ${response.status} ${response.statusText}\n`);

    const contentType = response.headers.get('content-type') || '';
    
    if (response.status === 200 && contentType.includes('text/html')) {
      const html = await response.text();
      console.log(`✅ Success! HTML generated (${html.length} characters)`);
      console.log(`   Has DOCTYPE: ${html.includes('<!DOCTYPE')}`);
      console.log(`   Has title: ${html.includes('<title>')}`);
      console.log(`\n📄 First 500 characters:\n${html.substring(0, 500)}...\n`);
    } else {
      const errorText = await response.text();
      console.log(`❌ Error Response:\n${errorText}\n`);
    }
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    if (error.cause) {
      console.error(`   Cause: ${error.cause}`);
    }
  }
}

renderHTML();

