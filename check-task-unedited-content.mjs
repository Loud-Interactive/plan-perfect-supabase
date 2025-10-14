// Check unedited_content from task
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = 'https://jsypctdhynsdqrfifvdh.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpzeXBjdGRoeW5zZHFyZmlmdmRoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0MDY5MjAzMiwiZXhwIjoyMDU2MjY4MDMyfQ.19Eds9LcZbb-rwLCpPJsk7kMIa7eTU7wIw_-Yn_iyG8';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const outlineGuid = '6139b555-7e63-4e6d-b161-0de3fee31aee';

// First, find all tasks for this outline
console.log('Finding tasks for outline:', outlineGuid);
const { data: tasks, error: tasksError } = await supabase
  .from('tasks')
  .select('task_id, status, created_at, updated_at, unedited_content, post_html')
  .eq('content_plan_outline_guid', outlineGuid)
  .order('created_at', { ascending: false});

if (tasksError) {
  console.error('Error:', tasksError);
  Deno.exit(1);
}

console.log(`\nFound ${tasks.length} tasks:\n`);
tasks.forEach((task, i) => {
  const markdownLength = task.unedited_content?.length || 0;
  const htmlLength = task.post_html?.length || 0;

  console.log(`${i + 1}. Task ID: ${task.task_id}`);
  console.log(`   Status: ${task.status}`);
  console.log(`   Created: ${task.created_at}`);
  console.log(`   Updated: ${task.updated_at}`);
  console.log(`   Markdown length: ${markdownLength}`);
  console.log(`   HTML length: ${htmlLength}`);
  console.log('');
});

// Check if any task has unedited_content
const tasksWithContent = tasks.filter(t => t.unedited_content && t.unedited_content.length > 0);
if (tasksWithContent.length === 0) {
  console.log('❌ No tasks have unedited_content!');
  console.log('This means the markdown hasn\'t been generated yet.');
} else {
  console.log(`✅ ${tasksWithContent.length} task(s) have unedited_content`);
  console.log('We should be using that existing markdown!');

  // Show first 500 chars of the first task's markdown
  console.log('\n=== First Task Markdown Preview ===');
  console.log(tasksWithContent[0].unedited_content.substring(0, 500));
}
