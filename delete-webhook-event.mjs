// Delete the conflicting webhook event
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = 'https://jsypctdhynsdqrfifvdh.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpzeXBjdGRoeW5zZHFyZmlmdmRoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0MDY5MjAzMiwiZXhwIjoyMDU2MjY4MDMyfQ.19Eds9LcZbb-rwLCpPJsk7kMIa7eTU7wIw_-Yn_iyG8';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const taskId = '6673c965-c27a-4032-b849-3349dd4c20a2';

console.log(`Deleting webhook event for task ${taskId}...`);

const { error } = await supabase
  .from('webhook_events_queue')
  .delete()
  .eq('id', taskId);

if (error) {
  console.error('Error deleting webhook event:', error);
} else {
  console.log('✅ Webhook event deleted successfully');
  console.log('You can now retry the generate-side-by-side function');
}
