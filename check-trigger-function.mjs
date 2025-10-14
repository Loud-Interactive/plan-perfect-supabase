#!/usr/bin/env node

const SUPABASE_URL = 'https://jsypctdhynsdqrfifvdh.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error('❌ Error: SUPABASE_SERVICE_ROLE_KEY environment variable not set');
  process.exit(1);
}

async function checkTriggerFunction() {
  try {
    // Get the function definition
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/pg_get_functiondef`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'apikey': SUPABASE_SERVICE_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        funcoid: "trigger_outline_webhook"
      })
    });

    if (response.ok) {
      const result = await response.json();
      console.log('Function definition:', result);
    } else {
      console.log('Could not fetch via RPC, trying direct query...');

      // Alternative: query pg_proc directly
      const queryResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/rpc/exec_sql`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
            'apikey': SUPABASE_SERVICE_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            query: `
              SELECT
                p.proname AS function_name,
                pg_get_functiondef(p.oid) AS function_definition
              FROM pg_proc p
              JOIN pg_namespace n ON p.pronamespace = n.oid
              WHERE p.proname = 'trigger_outline_webhook'
              AND n.nspname = 'public';
            `
          })
        }
      );

      if (queryResponse.ok) {
        const result = await queryResponse.json();
        console.log('Function found:', JSON.stringify(result, null, 2));
      } else {
        console.log('Response status:', queryResponse.status);
        const text = await queryResponse.text();
        console.log('Response:', text);
      }
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}

checkTriggerFunction();
