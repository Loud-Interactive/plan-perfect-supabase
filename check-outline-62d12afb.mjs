// Check outline and task for 62d12afb-d0b6-4ce6-a1e3-f1d6555a58d3
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = 'https://jsypctdhynsdqrfifvdh.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpzeXBjdGRoeW5zZHFyZmlmdmRoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0MDY5MjAzMiwiZXhwIjoyMDU2MjY4MDMyfQ.19Eds9LcZbb-rwLCpPJsk7kMIa7eTU7wIw_-Yn_iyG8';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const outlineGuid = '62d12afb-d0b6-4ce6-a1e3-f1d6555a58d3';

// Check outline
console.log('=== CHECKING OUTLINE ===');
const { data: outline, error: outlineError } = await supabase
  .from('content_plan_outlines')
  .select('post_title, domain')
  .eq('guid', outlineGuid)
  .single();

if (outlineError) {
  console.error('Outline error:', outlineError);
} else {
  console.log('Post title:', outline.post_title);
  console.log('Domain:', outline.domain);
}

// Check for existing tasks
console.log('\n=== CHECKING TASKS ===');
const { data: tasks, error: tasksError } = await supabase
  .from('tasks')
  .select('task_id, status, title, created_at, updated_at, unedited_content, post_json, post_html')
  .eq('content_plan_outline_guid', outlineGuid)
  .order('created_at', { ascending: false });

if (tasksError) {
  console.error('Tasks error:', tasksError);
} else if (!tasks || tasks.length === 0) {
  console.log('No tasks found for this outline');
} else {
  console.log(`Found ${tasks.length} task(s):\n`);
  tasks.forEach((task, i) => {
    console.log(`${i + 1}. Task ID: ${task.task_id}`);
    console.log(`   Status: ${task.status}`);
    console.log(`   Title: ${task.title}`);
    console.log(`   Created: ${task.created_at}`);
    console.log(`   Updated: ${task.updated_at}`);
    console.log(`   Has unedited_content: ${task.unedited_content ? 'YES (' + task.unedited_content.length + ' chars)' : 'NO'}`);
    console.log(`   Has post_json: ${task.post_json ? 'YES' : 'NO'}`);
    console.log(`   Has post_html: ${task.post_html ? 'YES (' + task.post_html.length + ' chars)' : 'NO'}`);
    console.log('');
  });
}
