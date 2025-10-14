// Check markdown from task
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = 'https://jsypctdhynsdqrfifvdh.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpzeXBjdGRoeW5zZHFyZmlmdmRoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0MDY5MjAzMiwiZXhwIjoyMDU2MjY4MDMyfQ.19Eds9LcZbb-rwLCpPJsk7kMIa7eTU7wIw_-Yn_iyG8';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const taskId = '79b56db9-4579-4c89-8d13-5e7a7871964e';

const { data, error } = await supabase
  .from('tasks')
  .select('unedited_content, updated_at')
  .eq('task_id', taskId)
  .single();

if (error) {
  console.error('Error:', error);
  Deno.exit(1);
}

console.log('Last updated:', data.updated_at);
console.log('\n=== MARKDOWN CONTENT ===\n');
console.log(data.unedited_content);

// Count H2 and H3 headings
const h2Count = (data.unedited_content.match(/^## /gm) || []).length;
const h3Count = (data.unedited_content.match(/^### /gm) || []).length;

console.log('\n=== HEADING COUNTS ===');
console.log(`H2 headings (##): ${h2Count}`);
console.log(`H3 headings (###): ${h3Count}`);
