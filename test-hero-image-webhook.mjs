#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import crypto from 'crypto';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = join(__dirname, '.env');

if (readFileSync(envPath, 'utf8')) {
  config({ path: envPath });
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing environment variables');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function testHeroImageWebhook() {
  console.log('🧪 TESTING WEBHOOK WITH hero_image_url');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  const taskId = 'ae1c8678-4178-4fe9-888a-2674af83a959';
  
  // Fetch task data to see if hero_image_url exists
  console.log('📥 Fetching task data...');
  const { data: task, error: taskError } = await supabase
    .from('tasks')
    .select('*')
    .eq('task_id', taskId)
    .single();
  
  if (taskError) {
    console.error('❌ Error fetching task:', taskError.message);
    return;
  }
  
  console.log(`✅ Task found: ${task.title}`);
  console.log(`📸 Hero Image URL: ${task.hero_image_url || '(not set)'}\n`);
  
  // Construct the webhook payload as it would be sent
  console.log('📦 WEBHOOK PAYLOAD THAT WOULD BE SENT:');
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
      hero_image_url: task.hero_image_url,  // ← THIS IS THE NEW FIELD
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
  console.log('📊 PAYLOAD DETAILS:');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`📏 Payload size: ${JSON.stringify(finalPayload).length} bytes`);
  console.log(`🔐 Signature: ${signature}`);
  console.log(`📸 Hero Image URL included: ${finalPayload.data.hero_image_url ? '✅ YES' : '❌ NO'}`);
  
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('📤 HEADERS THAT WOULD BE SENT:');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(JSON.stringify({
    'Content-Type': 'application/json',
    'X-Webhook-Signature': signature,
    'X-Webhook-Event': 'content_complete',
    'X-Webhook-ID': '90a96442-89cb-4a2c-bcef-1bb288e48d24',
    'X-Webhook-GUID': taskId,
    'X-Webhook-Timestamp': payloadWithoutSignature.timestamp
  }, null, 2));
  
  console.log('\n✅ Test complete!');
}

testHeroImageWebhook().catch(console.error);

