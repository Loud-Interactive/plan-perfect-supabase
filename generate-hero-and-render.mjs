#!/usr/bin/env node

/**
 * Script to generate hero image and regenerate HTML for a task
 * Usage: node generate-hero-and-render.mjs <task_id>
 */

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jsypctdhynsdqrfifvdh.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpzeXBjdGRoeW5zZHFyZmlmdmRoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0MDY5MjAzMiwiZXhwIjoyMDU2MjY4MDMyfQ.19Eds9LcZbb-rwLCpPJsk7kMIa7eTU7wIw_-Yn_iyG8';

const taskId = process.argv[2];

if (!taskId) {
  console.error('❌ Error: Task ID is required');
  console.error('Usage: node generate-hero-and-render.mjs <task_id>');
  process.exit(1);
}

async function main() {
  try {
    console.log(`🔍 Looking up task: ${taskId}`);
    
    // Step 1: Get the task and its content_plan_outline_guid
    const taskResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/tasks?task_id=eq.${taskId}&select=content_plan_outline_guid,task_id`,
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
    
    const taskData = taskDataArray[0];
    const contentPlanOutlineGuid = taskData.content_plan_outline_guid;
    
    if (!contentPlanOutlineGuid) {
      console.error('❌ Error: Task does not have a content_plan_outline_guid');
      process.exit(1);
    }
    
    console.log(`✅ Found task with content_plan_outline_guid: ${contentPlanOutlineGuid}`);
    
    // Step 2: Generate hero image prompt
    console.log('\n🚀 Step 1: Generating hero image prompt...');
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
    console.log(`   Prompt ID: ${promptResult?.save_status?.hero_image_prompt_id || 'N/A'}`);
    
    // Step 3: Generate hero image
    console.log('\n🚀 Step 2: Generating hero image...');
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
    console.log(`   Hero image URL: ${imageResult?.hero_image_url || 'N/A'}`);
    
    // Step 4: Regenerate HTML
    console.log('\n🚀 Step 3: Regenerating HTML...');
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
    if (contentType.includes('text/html')) {
      const htmlText = await htmlResponse.text();
      console.log('✅ HTML regenerated successfully');
      console.log(`   HTML length: ${htmlText.length} characters`);
      console.log(`   Status: ${htmlResponse.status}`);
    } else {
      const htmlResult = await htmlResponse.json();
      console.log('✅ HTML regenerated successfully');
      console.log(`   HTML URL: ${htmlResult?.html_url || 'N/A'}`);
      console.log(`   Supabase HTML URL: ${htmlResult?.supabase_html_url || 'N/A'}`);
    }
    
    console.log('\n✅ All steps completed successfully!');
    
  } catch (error) {
    console.error('❌ Unexpected error:', error);
    process.exit(1);
  }
}

main();

