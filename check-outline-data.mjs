#!/usr/bin/env node
/**
 * Check what data exists for a content_plan_outline_guid
 */

const guid = process.argv[2] || 'f7cdc198-1654-4e59-99f4-e1ad31d63198';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jsypctdhynsdqrfifvdh.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

async function checkData() {
  console.log(`🔍 Checking data for content_plan_outline_guid: ${guid}\n`);

  // Check tasks
  const tasksResponse = await fetch(`${SUPABASE_URL}/rest/v1/tasks?content_plan_outline_guid=eq.${guid}&select=*&limit=5`, {
    headers: {
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'apikey': SUPABASE_SERVICE_KEY
    }
  });
  
  if (tasksResponse.ok) {
    const tasks = await tasksResponse.json();
    console.log(`📋 Tasks found: ${tasks.length}`);
    if (tasks.length > 0) {
      console.log(`   First task: ${JSON.stringify(tasks[0], null, 2).substring(0, 500)}...\n`);
    }
  }

  // Check content_plan_outlines
  const outlinesResponse = await fetch(`${SUPABASE_URL}/rest/v1/content_plan_outlines?guid=eq.${guid}&select=*&limit=1`, {
    headers: {
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'apikey': SUPABASE_SERVICE_KEY
    }
  });
  
  if (outlinesResponse.ok) {
    const outlines = await outlinesResponse.json();
    console.log(`📄 Outlines found: ${outlines.length}`);
    if (outlines.length > 0) {
      const outline = outlines[0];
      console.log(`   Title: ${outline.title || 'N/A'}`);
      console.log(`   Keyword: ${outline.keyword || 'N/A'}`);
      console.log(`   Domain: ${outline.domain || 'N/A'}`);
      console.log(`   Has outline: ${!!outline.outline}\n`);
    }
  }
}

checkData().catch(console.error);

