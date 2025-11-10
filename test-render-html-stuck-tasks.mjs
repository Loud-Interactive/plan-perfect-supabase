#!/usr/bin/env node
/**
 * Test render-rich-json-to-html on stuck tasks
 */

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jsypctdhynsdqrfifvdh.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_SERVICE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not found in environment');
  process.exit(1);
}

const tasks = [
  {
    task_id: '73b75fd0-60ba-4514-9b40-8ada11fe41c9',
    content_plan_outline_guid: 'ffc60d2c-1cfc-4423-847c-74657eba7080',
    title: 'Best Fancy Chocolate and Coffee Pairings to Wake Your Senses'
  },
  {
    task_id: 'dd36c10b-7c25-4022-8605-238b8a48ddde',
    content_plan_outline_guid: '837dd6aa-81cf-42d1-a316-6e278ca4b0f0',
    title: 'Champagne and Fancy Chocolate: A Luxurious Pairing Guide'
  },
  {
    task_id: '4ea2dee3-0c41-47bd-9ef6-668f48afbe22',
    content_plan_outline_guid: '1a779d7b-793f-451c-bf43-f21f32f59f58',
    title: 'Milk Chocolate Boxes: Creamy Delights for Every Occasion'
  }
];

async function testRenderHTML(task) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🚀 Testing: ${task.title}`);
  console.log(`   task_id: ${task.task_id}`);
  console.log(`   content_plan_outline_guid: ${task.content_plan_outline_guid}`);
  console.log(`${'='.repeat(80)}\n`);
  
  try {
    const startTime = Date.now();
    
    const response = await fetch(`${SUPABASE_URL}/functions/v1/render-rich-json-to-html`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
      },
      body: JSON.stringify({
        task_id: task.task_id,
        content_plan_outline_guid: task.content_plan_outline_guid
      })
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`📊 Response Status: ${response.status} ${response.statusText}`);
    console.log(`⏱️  Duration: ${duration}s\n`);

    const contentType = response.headers.get('content-type') || '';
    
    if (response.status === 200 && contentType.includes('text/html')) {
      const html = await response.text();
      console.log(`✅ Success! HTML generated`);
      console.log(`   HTML length: ${html.length} characters`);
      console.log(`   Has DOCTYPE: ${html.includes('<!DOCTYPE')}`);
      console.log(`   Has title: ${html.includes('<title>')}`);
      console.log(`\n📄 First 500 characters:\n${html.substring(0, 500)}...\n`);
      return { success: true, htmlLength: html.length };
    } else {
      const errorText = await response.text();
      console.log(`❌ Error Response:\n${errorText}\n`);
      return { success: false, error: errorText };
    }
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    if (error.cause) {
      console.error(`   Cause: ${error.cause}`);
    }
    return { success: false, error: error.message };
  }
}

async function main() {
  console.log('🧪 Testing render-rich-json-to-html on stuck tasks\n');
  
  const results = [];
  
  for (const task of tasks) {
    const result = await testRenderHTML(task);
    results.push({ task, result });
    
    // Wait a bit between requests
    if (task !== tasks[tasks.length - 1]) {
      console.log('⏳ Waiting 2 seconds before next request...\n');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  console.log(`\n${'='.repeat(80)}`);
  console.log('📊 Summary:');
  console.log(`${'='.repeat(80)}\n`);
  
  results.forEach(({ task, result }) => {
    const status = result.success ? '✅ SUCCESS' : '❌ FAILED';
    console.log(`${status} - ${task.title}`);
    if (result.success) {
      console.log(`   HTML length: ${result.htmlLength} characters`);
    } else {
      console.log(`   Error: ${result.error?.substring(0, 200)}...`);
    }
    console.log('');
  });
  
  const successCount = results.filter(r => r.result.success).length;
  console.log(`\n✅ ${successCount}/${tasks.length} tasks succeeded`);
}

main().catch(console.error);

