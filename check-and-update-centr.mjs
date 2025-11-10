#!/usr/bin/env node
/**
 * Check existing loud-articles in Centr and update with unique slug if needed
 */

import crypto from 'crypto';

const contentPlanOutlineGuid = process.argv[2];

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jsypctdhynsdqrfifvdh.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const LOUD_API_KEY = process.env.LOUD_API_KEY || 'sk_aD92Fj4mTq8nR7vX0zY1cB6pLw3hK9uE5sN2tG4r';
const LOUD_WEBHOOK_SECRET = process.env.LOUD_WEBHOOK_SECRET || 'iWV4T6G7qX9bJPh9cg9djnBKPSLjzrfgPr6rEnyiyyxUiftLNT256vtI5oZPP';
const HOSTNAME = process.env.HOSTNAME || 'centr.com';

if (!contentPlanOutlineGuid) {
  console.error('❌ Error: content_plan_outline_guid is required');
  console.error('Usage: node check-and-update-centr.mjs <content_plan_outline_guid>');
  process.exit(1);
}

async function checkAndUpdate() {
  try {
    console.log(`🔍 Checking existing articles for content_plan_outline_guid: ${contentPlanOutlineGuid}\n`);

    // Step 1: Fetch task data
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

    // Step 2: Check existing articles in Centr
    console.log('📋 Checking existing articles in Centr...\n');
    const listUrl = `https://${HOSTNAME}/webhooks/v1/loud-articles?code=${LOUD_API_KEY}`;
    
    const listResponse = await fetch(listUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!listResponse.ok) {
      const errorText = await listResponse.text();
      console.error(`❌ Failed to fetch articles: ${listResponse.status}`);
      console.error(`Response: ${errorText}`);
      process.exit(1);
    }

    const articlesData = await listResponse.json();
    const articles = Array.isArray(articlesData) ? articlesData : (articlesData.articles || articlesData.data || []);
    console.log(`✅ Found ${articles.length || 0} articles in Centr\n`);

    // Step 3: Check if our article exists (Centr uses task_id as 'id')
    const existingArticle = Array.isArray(articles) ? articles.find(a => a.metadata?.id === task.task_id) : null;
    
    if (existingArticle) {
      console.log('📄 Found existing article:');
      console.log(`   ID: ${existingArticle.metadata?.id || 'N/A'}`);
      console.log(`   Slug: ${existingArticle.metadata?.slug || 'N/A'}`);
      console.log(`   Title: ${existingArticle.metadata?.title || 'N/A'}`);
      console.log(`   Live URL: ${existingArticle.metadata?.live_post_url || 'N/A'}\n`);
    } else {
      console.log('ℹ️  No existing article found with this task_id\n');
    }

    // Step 4: Create unique slug (add timestamp if needed to ensure uniqueness)
    let baseSlug = task.title 
      ? task.title.toLowerCase()
          .replace(/[^\w\s-]/g, '')
          .replace(/\s+/g, '-')
          .replace(/-+/g, '-')
          .trim()
      : task.task_id;

    // Check if slug already exists (for different task_id)
    const slugExists = Array.isArray(articles) && articles.some(a => a.metadata?.slug === baseSlug && a.metadata?.id !== task.task_id);
    
    let finalSlug = baseSlug;
    if (slugExists) {
      // Add GUID suffix to make it unique
      const guidSuffix = contentPlanOutlineGuid.split('-')[0];
      finalSlug = `${baseSlug}-${guidSuffix}`;
      console.log(`⚠️  Slug "${baseSlug}" already exists, using unique slug: "${finalSlug}"\n`);
    } else {
      console.log(`✅ Slug "${finalSlug}" is unique\n`);
    }

    // Step 5: Build update payload
    const payload = {
      data: {
        slug: finalSlug,
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

    // Generate signature
    const payloadString = JSON.stringify(payload);
    const hmac = crypto.createHmac('sha256', LOUD_WEBHOOK_SECRET);
    hmac.update(payloadString);
    const signature = `sha256=${hmac.digest('hex')}`;
    payload.signature = signature;

    console.log('📦 Update Payload:');
    console.log(JSON.stringify(payload, null, 2));
    console.log('\n');

    // Step 6: Send update webhook
    const updateUrl = `https://${HOSTNAME}/webhooks/v1/loud-articles?code=${LOUD_API_KEY}`;
    console.log(`📤 Sending update webhook to: ${updateUrl}\n`);

    const updateResponse = await fetch(updateUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': signature
      },
      body: JSON.stringify(payload)
    });

    const responseText = await updateResponse.text();
    
    console.log(`📊 Response Status: ${updateResponse.status} ${updateResponse.statusText}`);
    
    if (updateResponse.ok) {
      console.log('✅ Article updated successfully!');
      try {
        const responseJson = JSON.parse(responseText);
        console.log('Response:', JSON.stringify(responseJson, null, 2));
      } catch {
        console.log('Response:', responseText);
      }
    } else {
      console.log('❌ Update failed');
      console.log('Response:', responseText);
      process.exit(1);
    }

  } catch (error) {
    console.error('❌ Unexpected error:', error);
    process.exit(1);
  }
}

checkAndUpdate().catch(console.error);

