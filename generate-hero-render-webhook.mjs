#!/usr/bin/env node

/**
 * Script to generate hero image, regenerate HTML, and send webhook for a task
 * Usage: node generate-hero-render-webhook.mjs <task_id>
 */

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jsypctdhynsdqrfifvdh.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpzeXBjdGRoeW5zZHFyZmlmdmRoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0MDY5MjAzMiwiZXhwIjoyMDU2MjY4MDMyfQ.19Eds9LcZbb-rwLCpPJsk7kMIa7eTU7wIw_-Yn_iyG8';
const LOUD_API_KEY = process.env.LOUD_API_KEY || 'sk_aD92Fj4mTq8nR7vX0zY1cB6pLw3hK9uE5sN2tG4r';
const LOUD_WEBHOOK_SECRET = process.env.LOUD_WEBHOOK_SECRET || 'iWV4T6G7qX9bJPh9cg9djnBKPSLjzrfgPr6rEnyiyyxUiftLNT256vtI5oZPP';
const HOSTNAME = process.env.HOSTNAME || 'centr.com';

import crypto from 'crypto';

const taskId = process.argv[2];

if (!taskId) {
  console.error('❌ Error: Task ID is required');
  console.error('Usage: node generate-hero-render-webhook.mjs <task_id>');
  process.exit(1);
}

async function main() {
  try {
    console.log(`🔍 Looking up task: ${taskId}\n`);
    
    // Step 1: Get the task and its content_plan_outline_guid
    const taskResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/tasks?task_id=eq.${taskId}&select=*`,
      {
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    if (!taskResponse.ok) {
      const errorText = await taskResponse.text();
      console.error('❌ Error fetching task:', errorText);
      process.exit(1);
    }
    
    const taskDataArray = await taskResponse.json();
    
    if (!taskDataArray || taskDataArray.length === 0) {
      console.error('❌ Error: Task not found');
      process.exit(1);
    }
    
    const task = taskDataArray[0];
    const contentPlanOutlineGuid = task.content_plan_outline_guid;
    
    if (!contentPlanOutlineGuid) {
      console.error('❌ Error: Task does not have a content_plan_outline_guid');
      process.exit(1);
    }
    
    console.log(`✅ Found task:`);
    console.log(`   Title: ${task.title || 'N/A'}`);
    console.log(`   Status: ${task.status || 'N/A'}`);
    console.log(`   Domain: ${task.client_domain || 'N/A'}`);
    console.log(`   Content Plan Outline GUID: ${contentPlanOutlineGuid}\n`);
    
    // Step 2: Generate hero image prompt
    console.log('🚀 Step 1: Generating hero image prompt...');
    const promptResponse = await fetch(
      `${SUPABASE_URL}/functions/v1/generate-hero-image-prompt`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
        },
        body: JSON.stringify({
          content_plan_outline_guid: contentPlanOutlineGuid,
          use_unedited_content: true
        })
      }
    );
    
    if (!promptResponse.ok) {
      const errorText = await promptResponse.text();
      console.error('❌ Error generating prompt:', errorText);
      process.exit(1);
    }
    
    const promptResult = await promptResponse.json();
    console.log('✅ Hero image prompt generated successfully');
    console.log(`   Prompt ID: ${promptResult?.save_status?.hero_image_prompt_id || 'N/A'}\n`);
    
    // Step 3: Generate hero image
    console.log('🚀 Step 2: Generating hero image...');
    const imageResponse = await fetch(
      `${SUPABASE_URL}/functions/v1/generate-hero-image`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
        },
        body: JSON.stringify({
          guid: contentPlanOutlineGuid,
          regenerate: false
        })
      }
    );
    
    if (!imageResponse.ok) {
      const errorText = await imageResponse.text();
      console.error('❌ Error generating image:', errorText);
      process.exit(1);
    }
    
    const imageResult = await imageResponse.json();
    console.log('✅ Hero image generated successfully');
    console.log(`   Hero image URL: ${imageResult?.hero_image_url || 'N/A'}\n`);
    
    // Step 4: Regenerate HTML
    console.log('🚀 Step 3: Regenerating HTML...');
    const htmlResponse = await fetch(
      `${SUPABASE_URL}/functions/v1/render-rich-json-to-html`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
        },
        body: JSON.stringify({
          task_id: taskId
        })
      }
    );
    
    if (!htmlResponse.ok) {
      const errorText = await htmlResponse.text();
      console.error('❌ Error regenerating HTML:', errorText);
      process.exit(1);
    }
    
    const contentType = htmlResponse.headers.get('content-type') || '';
    let htmlLength = 0;
    if (contentType.includes('text/html')) {
      const htmlText = await htmlResponse.text();
      htmlLength = htmlText.length;
      console.log('✅ HTML regenerated successfully');
      console.log(`   HTML length: ${htmlLength} characters`);
      console.log(`   Status: ${htmlResponse.status}\n`);
    } else {
      const htmlResult = await htmlResponse.json();
      console.log('✅ HTML regenerated successfully');
      console.log(`   HTML URL: ${htmlResult?.html_url || 'N/A'}`);
      console.log(`   Supabase HTML URL: ${htmlResult?.supabase_html_url || 'N/A'}\n`);
    }
    
    // Step 5: Verify HTML is correct (check if it's substantial)
    if (htmlLength < 1000 && !task.supabase_html_url) {
      console.log('⚠️  Warning: HTML seems too short. Skipping webhook.');
      console.log('✅ Hero image and HTML generation completed, but webhook not sent due to HTML length check.');
      return;
    }
    
    // Step 6: Fetch updated task data for webhook
    console.log('🚀 Step 4: Fetching updated task data for webhook...');
    const updatedTaskResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/tasks?task_id=eq.${taskId}&select=*`,
      {
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    if (!updatedTaskResponse.ok) {
      console.error('⚠️  Warning: Could not fetch updated task data. Skipping webhook.');
      return;
    }
    
    const updatedTaskArray = await updatedTaskResponse.json();
    const updatedTask = updatedTaskArray?.[0] || task;
    
    // Step 7: Check existing articles to ensure unique slug
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
    
    // Create slug from title
    let baseSlug = updatedTask.title 
      ? updatedTask.title.toLowerCase()
          .replace(/[^\w\s-]/g, '')
          .replace(/\s+/g, '-')
          .replace(/-+/g, '-')
          .trim()
      : taskId;
    
    // Ensure slug is unique
    let slug = baseSlug;
    const slugExists = existingArticles.some(a => {
      const articleId = a.metadata?.id || a.id;
      const articleSlug = a.metadata?.slug || a.slug;
      return articleSlug === baseSlug && articleId !== taskId;
    });
    
    if (slugExists) {
      const guidSuffix = taskId.split('-')[0];
      slug = `${baseSlug}-${guidSuffix}`;
      console.log(`⚠️  Slug "${baseSlug}" exists, using unique slug: "${slug}"`);
    }
    
    // Step 8: Send webhook
    console.log('\n🚀 Step 5: Sending webhook to Centr...');
    
    const payload = {
      data: {
        slug: slug,
        error: null,
        title: updatedTask.title || 'Untitled',
        status: updatedTask.status || 'Completed',
        html_link: updatedTask.html_link || updatedTask.supabase_html_url || null,
        seo_keyword: updatedTask.keyword || updatedTask.post_keyword || null,
        client_domain: updatedTask.client_domain || null,
        live_post_url: updatedTask.live_post_url || null,
        hero_image_url: updatedTask.hero_image_url || null,
        google_doc_link: updatedTask.google_doc_link || null,
        meta_description: updatedTask.meta_description || null
      },
      guid: taskId, // Use task_id as guid (Centr expects task_id, not content_plan_outline_guid)
      event: 'content_complete',
      timestamp: new Date().toISOString()
    };
    
    // Generate signature
    const payloadString = JSON.stringify(payload);
    const hmac = crypto.createHmac('sha256', LOUD_WEBHOOK_SECRET);
    hmac.update(payloadString);
    const signature = `sha256=${hmac.digest('hex')}`;
    payload.signature = signature;
    
    const url = `https://${HOSTNAME}/webhooks/v1/loud-articles?code=${LOUD_API_KEY}`;
    
    const webhookResponse = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': signature
      },
      body: JSON.stringify(payload)
    });
    
    const responseText = await webhookResponse.text();
    
    console.log(`📊 Webhook Response Status: ${webhookResponse.status} ${webhookResponse.statusText}`);
    
    if (webhookResponse.ok) {
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
      process.exit(1);
    }
    
    console.log('\n✅ All steps completed successfully!');
    
  } catch (error) {
    console.error('❌ Unexpected error:', error);
    process.exit(1);
  }
}

main();

