// Check webhook_events_queue table and database triggers
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = 'https://jsypctdhynsdqrfifvdh.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpzeXBjdGRoeW5zZHFyZmlmdmRoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0MDY5MjAzMiwiZXhwIjoyMDU2MjY4MDMyfQ.19Eds9LcZbb-rwLCpPJsk7kMIa7eTU7wIw_-Yn_iyG8';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

console.log('=== Checking webhook_events_queue table ===');

// Check recent entries in webhook_events_queue
const { data: webhookEvents, error: webhookError } = await supabase
  .from('webhook_events_queue')
  .select('*')
  .order('created_at', { ascending: false })
  .limit(10);

if (webhookError) {
  console.error('Error querying webhook_events_queue:', webhookError);
} else {
  console.log(`Found ${webhookEvents?.length || 0} recent webhook events:`);
  webhookEvents?.forEach((event, i) => {
    console.log(`\n${i + 1}. Event ID: ${event.id || 'N/A'}`);
    console.log(`   Event Type: ${event.event_type}`);
    console.log(`   Domain: ${event.domain}`);
    console.log(`   Processed: ${event.processed}`);
    console.log(`   Created: ${event.created_at}`);
  });
}

console.log('\n=== Checking database triggers on tasks table ===');

// Query pg_trigger to see what triggers are on the tasks table
const { data: triggers, error: triggerError } = await supabase.rpc('exec_sql', {
  sql: `
    SELECT
      t.tgname as trigger_name,
      t.tgenabled as enabled,
      pg_get_triggerdef(t.oid) as trigger_definition
    FROM pg_trigger t
    WHERE t.tgrelid = 'public.tasks'::regclass
    AND NOT t.tgisinternal
    ORDER BY t.tgname;
  `
});

if (triggerError) {
  console.error('Error querying triggers (trying alternative method):', triggerError);

  // Try alternative: just check if there's a webhook configuration
  console.log('\nChecking for Supabase database webhooks configuration...');
  console.log('(This would be configured in Supabase Dashboard under Database > Webhooks)');
} else {
  console.log('Triggers found:', triggers);
}

console.log('\n=== Done ===');
