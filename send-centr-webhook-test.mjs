#!/usr/bin/env node
/**
 * Send Centr webhook for a content_plan_outline_guid
 * Based on Centr's webhook test script format
 */

import crypto from 'crypto';

const contentPlanOutlineGuid = process.argv[2] || 'd7201503-78be-44f6-bc5d-50d24ab12ee4';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jsypctdhynsdqrfifvdh.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
// Use environment variables or default to actual values from database
const LOUD_API_KEY = process.env.LOUD_API_KEY || 'sk_aD92Fj4mTq8nR7vX0zY1cB6pLw3hK9uE5sN2tG4r';
const LOUD_WEBHOOK_SECRET = process.env.LOUD_WEBHOOK_SECRET || 'iWV4T6G7qX9bJPh9cg9djnBKPSLjzrfgPr6rEnyiyyxUiftLNT256vtI5oZPP';
const HOSTNAME = process.env.HOSTNAME || 'centr.com';

if (!SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing SUPABASE_SERVICE_ROLE_KEY env var');
  process.exit(1);
}

if (!LOUD_API_KEY || !LOUD_WEBHOOK_SECRET) {
  console.error('❌ Missing LOUD_API_KEY or LOUD_WEBHOOK_SECRET env vars');
  console.error('   Set these in your .env file or environment');
  process.exit(1);
}

async function sendWebhook() {
  console.log(`🔍 Fetching data for content_plan_outline_guid: ${contentPlanOutlineGuid}\n`);

  // Fetch task data
  const tasksResponse = await fetch(`${SUPABASE_URL}/rest/v1/tasks?content_plan_outline_guid=eq.${contentPlanOutlineGuid}&select=*&order=created_at.desc&limit=1`, {
    headers: {
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'apikey': SUPABASE_SERVICE_KEY
    }
  });

  if (!tasksResponse.ok) {
    console.error(`❌ Failed to fetch tasks: ${tasksResponse.status}`);
    process.exit(1);
  }

  const tasks = await tasksResponse.json();

  if (!tasks || tasks.length === 0) {
    console.error(`❌ No task found for content_plan_outline_guid: ${contentPlanOutlineGuid}`);
    process.exit(1);
  }

  const task = tasks[0];
  console.log(`✅ Found task: ${task.task_id}`);
  console.log(`   Title: ${task.title || 'N/A'}`);
  console.log(`   Status: ${task.status || 'N/A'}`);
  console.log(`   Domain: ${task.client_domain || 'N/A'}\n`);

  // Check existing articles to ensure unique slug
  let existingArticles = [];
  try {
    const listUrl = `https://${HOSTNAME}/webhooks/v1/loud-articles?code=${LOUD_API_KEY}`;
    const listResponse = await fetch(listUrl, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    if (listResponse.ok) {
      const articlesData = await listResponse.json();
      existingArticles = Array.isArray(articlesData) ? articlesData : (articlesData.articles || articlesData.data || []);
      console.log(`📋 Found ${existingArticles.length} existing articles in Centr`);
    }
  } catch (err) {
    console.log(`⚠️  Could not check existing articles: ${err.message}`);
  }

  // Create slug from title or use task_id
  let baseSlug = task.title 
    ? task.title.toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .trim()
    : task.task_id;

  // Ensure slug is unique - check if it exists for a different GUID
  let slug = baseSlug;
  const slugExists = existingArticles.some(a => a.slug === baseSlug && a.guid !== contentPlanOutlineGuid);
  if (slugExists) {
    // Add GUID suffix to make it unique
    const guidSuffix = contentPlanOutlineGuid.split('-')[0];
    slug = `${baseSlug}-${guidSuffix}`;
    console.log(`⚠️  Slug "${baseSlug}" exists, using unique slug: "${slug}"`);
  }

  // Build payload
  // Note: Centr uses task_id as the 'id' field, so we use task_id as guid for updates
  const payload = {
    data: {
      slug: slug,
      error: null,
      title: task.title || 'Untitled',
      status: task.status || 'Completed',
      html_link: task.html_link || task.supabase_html_url || null,
      seo_keyword: task.keyword || task.post_keyword || null,
      client_domain: task.client_domain || null,
      live_post_url: task.live_post_url || null,
      hero_image_url: task.hero_image_url || null,
      google_doc_link: task.google_doc_link || null,
      meta_description: task.meta_description || null
    },
    guid: task.task_id, // Use task_id instead of content_plan_outline_guid for Centr compatibility
    event: 'content_complete',
    timestamp: new Date().toISOString()
  };

  // Generate signature (signature should NOT be in payload body, only in header)
  // But Centr's test script includes it in body, so we'll do both for compatibility
  const payloadString = JSON.stringify(payload);
  const hmac = crypto.createHmac('sha256', LOUD_WEBHOOK_SECRET);
  hmac.update(payloadString);
  const signature = `sha256=${hmac.digest('hex')}`;
  payload.signature = signature; // Include in body for Centr compatibility

  // Display info
  console.log('🔐 Webhook Information');
  console.log('═══════════════════════════════════════════════════\n');
  console.log('Secret:', LOUD_WEBHOOK_SECRET.substring(0, 16) + '...');
  console.log('API Key:', LOUD_API_KEY.substring(0, 16) + '...');
  console.log('Hostname:', HOSTNAME);
  console.log('Signature:', signature);
  console.log('\n📦 Payload:');
  console.log(JSON.stringify(payload, null, 2));
  console.log('\n');

  // Send webhook - use centr.com format (matching Centr's test script)
  const url = `https://${HOSTNAME}/webhooks/v1/loud-articles?code=${LOUD_API_KEY}`;
  // Alternative: https://shop.centr.com/api/webhooks/loud?code=${LOUD_API_KEY}
  console.log(`📤 Sending webhook to: ${url}\n`);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': signature
      },
      body: payloadString
    });

    const responseText = await response.text();
    
    console.log(`📊 Response Status: ${response.status} ${response.statusText}`);
    
    if (response.ok) {
      console.log('✅ Webhook sent successfully!');
      try {
        const responseJson = JSON.parse(responseText);
        console.log('Response:', JSON.stringify(responseJson, null, 2));
      } catch {
        console.log('Response:', responseText);
      }
    } else {
      console.log('❌ Webhook failed');
      console.log('Response:', responseText);
    }
  } catch (error) {
    console.error('❌ Error sending webhook:', error.message);
    process.exit(1);
  }
}

sendWebhook().catch(console.error);

