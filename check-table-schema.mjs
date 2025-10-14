// Check webhook_events_queue table schema
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = 'https://jsypctdhynsdqrfifvdh.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpzeXBjdGRoeW5zZHFyZmlmdmRoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0MDY5MjAzMiwiZXhwIjoyMDU2MjY4MDMyfQ.19Eds9LcZbb-rwLCpPJsk7kMIa7eTU7wIw_-Yn_iyG8';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

console.log('=== Checking webhook_events_queue table schema ===\n');

// Get one record to see the fields
const { data: sample, error } = await supabase
  .from('webhook_events_queue')
  .select('*')
  .limit(1)
  .single();

if (error) {
  console.error('Error:', error);
} else {
  console.log('Sample record fields:');
  Object.keys(sample).forEach(key => {
    console.log(`  ${key}: ${typeof sample[key]} = ${JSON.stringify(sample[key]).substring(0, 100)}`);
  });
}

console.log('\n=== Checking for database webhook configuration ===');
console.log('Task ID from our test: 6673c965-c27a-4032-b849-3349dd4c20a2');
console.log('\nLooking at existing event with this ID...');

const { data: existingEvent } = await supabase
  .from('webhook_events_queue')
  .select('*')
  .eq('id', '6673c965-c27a-4032-b849-3349dd4c20a2')
  .single();

if (existingEvent) {
  console.log('Found event with ID matching our task_id!');
  console.log('This confirms the primary key is the task_id');
  console.log('Event details:', JSON.stringify(existingEvent, null, 2));
}
