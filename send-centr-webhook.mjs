#!/usr/bin/env node

/**
 * Script to send a Centr webhook for a given content_plan_outline_guid
 * 
 * Usage:
 *   node send-centr-webhook.mjs <content_plan_outline_guid> [status]
 * 
 * Example:
 *   node send-centr-webhook.mjs fa4846f4-9391-4991-ba86-4717527e80b3 completed
 */

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jsypctdhynsdqrfifvdh.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Error: SUPABASE_SERVICE_ROLE_KEY environment variable not set');
  process.exit(1);
}

const contentPlanOutlineGuid = process.argv[2];
const status = process.argv[3] || 'completed';

if (!contentPlanOutlineGuid) {
  console.error('❌ Error: content_plan_outline_guid is required');
  console.error('\nUsage: node send-centr-webhook.mjs <content_plan_outline_guid> [status]');
  console.error('\nExample:');
  console.error('  node send-centr-webhook.mjs fa4846f4-9391-4991-ba86-4717527e80b3 completed');
  process.exit(1);
}

console.log(`\n🚀 Sending Centr webhook for content_plan_outline_guid: ${contentPlanOutlineGuid}`);
console.log(`📊 Status: ${status}\n`);

// Call update-task-status function which will trigger the webhook
const response = await fetch(`${SUPABASE_URL}/functions/v1/update-task-status`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
  },
  body: JSON.stringify({
    content_plan_outline_guid: contentPlanOutlineGuid,
    status: status
  })
});

const responseText = await response.text();
let responseData;

try {
  responseData = JSON.parse(responseText);
} catch (e) {
  responseData = { raw: responseText };
}

if (response.ok) {
  console.log('✅ Status updated successfully');
  console.log(`📤 Webhook should have been sent to Centr.com\n`);
  console.log('Response:', JSON.stringify(responseData, null, 2));
} else {
  console.error(`❌ Error: ${response.status} ${response.statusText}`);
  console.error('Response:', responseText);
  process.exit(1);
}

