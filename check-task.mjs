// Check task status
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = 'https://jsypctdhynsdqrfifvdh.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpzeXBjdGRoeW5zZHFyZmlmdmRoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0MDY5MjAzMiwiZXhwIjoyMDU2MjY4MDMyfQ.19Eds9LcZbb-rwLCpPJsk7kMIa7eTU7wIw_-Yn_iyG8';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const taskId = '73ed7d1d-9c1f-4208-a2ff-bd0cf56960f2';

const { data, error } = await supabase
  .from('tasks')
  .select('status, message, post_json, post_html, unedited_content')
  .eq('task_id', taskId)
  .single();

if (error) {
  console.error('Error:', error);
  Deno.exit(1);
}

console.log('Task status:', data.status);
console.log('Error message:', data.message);
console.log('Has markdown?', data.unedited_content ? 'YES' : 'NO');
console.log('Has JSON?', data.post_json ? 'YES' : 'NO');
console.log('Has HTML?', data.post_html ? 'YES' : 'NO');

if (data.post_json) {
  const json = typeof data.post_json === 'string' ? JSON.parse(data.post_json) : data.post_json;
  const jsonRefs = (JSON.stringify(json).match(/\[\d+\]/g) || []).length;
  console.log('JSON has', jsonRefs, 'reference citations');
}

if (data.unedited_content) {
  const mdRefs = (data.unedited_content.match(/\[\d+\]/g) || []).length;
  console.log('Markdown has', mdRefs, 'reference citations');
}
