#!/usr/bin/env node

import { readFileSync } from 'fs';
import crypto from 'crypto';

// Parse .env file
const envContent = readFileSync('.env', 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const [key, ...valueParts] = line.split('=');
  if (key && valueParts.length) {
    env[key.trim()] = valueParts.join('=').trim().replace(/^["']|["']$/g, '');
  }
});

const SUPABASE_URL = env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

async function testHeroImageWebhook() {
  console.log('🧪 TESTING WEBHOOK WITH hero_image_url');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  const taskId = 'ae1c8678-4178-4fe9-888a-2674af83a959';
  
  // Fetch task data
  console.log('📥 Fetching task data from database...');
  const taskResponse = await fetch(`${SUPABASE_URL}/rest/v1/tasks?task_id=eq.${taskId}&select=*`, {
    headers: {
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
    }
  });
  
  const tasks = await taskResponse.json();
  const task = tasks[0];
  
  if (!task) {
    console.error('❌ Task not found');
    return;
  }
  
  console.log(`✅ Task found: ${task.title}`);
  console.log(`📸 Hero Image URL: ${task.hero_image_url || '(not set)'}\n`);
  
  // Construct the webhook payload
  console.log('📦 WEBHOOK PAYLOAD (as Erik will receive it):');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  const webhookSecret = '1qaz2wsx3edc4rfv5tgb6yhn7ujm8ik9ol';
  
  const payloadWithoutSignature = {
    guid: taskId,
    event: 'content_complete',
    timestamp: new Date().toISOString(),
    data: {
      status: 'completed',
      title: task.title || '',
      slug: task.title ? task.title.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-') : '',
      client_domain: task.client_domain || 'centr.com',
      html_link: `https://jsypctdhynsdqrfifvdh.supabase.co/storage/v1/object/public/blogs/centr.com/${taskId}.html`,
      google_doc_link: task.google_doc_link,
      seo_keyword: task.seo_keyword,
      meta_description: task.meta_description,
      hero_image_url: task.hero_image_url,  // ← NEW FIELD REQUESTED BY ERIK
      live_post_url: task.live_post_url
    }
  };
  
  // Generate signature
  const payloadString = JSON.stringify(payloadWithoutSignature);
  const hmac = crypto.createHmac('sha256', webhookSecret);
  hmac.update(payloadString);
  const signature = 'sha256=' + hmac.digest('hex');
  
  // Add signature to payload
  const finalPayload = {
    ...payloadWithoutSignature,
    signature: signature
  };
  
  console.log(JSON.stringify(finalPayload, null, 2));
  
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('📊 SUMMARY:');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`📏 Payload size: ${JSON.stringify(finalPayload).length} bytes`);
  console.log(`🔐 Signature: ${signature}`);
  console.log(`📸 Hero Image URL: ${finalPayload.data.hero_image_url ? '✅ INCLUDED' : '❌ MISSING'}`);
  console.log(`   Value: ${finalPayload.data.hero_image_url || '(null)'}`);
  
  console.log('\n✅ Deployment complete! Erik will now receive hero_image_url in webhooks.');
}

testHeroImageWebhook().catch(console.error);

