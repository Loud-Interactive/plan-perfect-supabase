// Check if citations were preserved in the successful task
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = 'https://jsypctdhynsdqrfifvdh.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpzeXBjdGRoeW5zZHFyZmlmdmRoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0MDY5MjAzMiwiZXhwIjoyMDU2MjY4MDMyfQ.19Eds9LcZbb-rwLCpPJsk7kMIa7eTU7wIw_-Yn_iyG8';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Check the successful task
const taskId = '73ed7d1d-9c1f-4208-a2ff-bd0cf56960f2';

console.log(`Checking task ${taskId} for citation preservation...\n`);

const { data, error } = await supabase
  .from('tasks')
  .select('status, unedited_content, post_json, post_html')
  .eq('task_id', taskId)
  .single();

if (error) {
  console.error('Error:', error);
  Deno.exit(1);
}

console.log('Task status:', data.status);
console.log('Has markdown?', data.unedited_content ? 'YES' : 'NO');
console.log('Has JSON?', data.post_json ? 'YES' : 'NO');
console.log('Has HTML?', data.post_html ? 'YES' : 'NO');

if (data.unedited_content) {
  const mdRefs = (data.unedited_content.match(/\[(\d+)\]/g) || []).length;
  console.log(`\n✅ Markdown has ${mdRefs} reference citations`);
}

if (data.post_json) {
  const jsonStr = typeof data.post_json === 'string' ? data.post_json : JSON.stringify(data.post_json);
  const jsonRefs = (jsonStr.match(/\[(\d+)\]/g) || []).length;
  console.log(`✅ JSON has ${jsonRefs} reference citations`);

  if (jsonRefs > 0) {
    console.log('\n🎉 SUCCESS! Citations were preserved in JSON!');
  } else {
    console.log('\n❌ FAILED: No citations in JSON');
  }
}

if (data.post_html) {
  const htmlRefs = (data.post_html.match(/<sup><a href="#ref\d+"[^>]*>\d+<\/a><\/sup>/g) || []).length;
  console.log(`✅ HTML has ${htmlRefs} reference superscripts`);

  if (htmlRefs > 0) {
    console.log('🎉 SUCCESS! Citations were converted to HTML superscripts!');
  } else {
    console.log('❌ FAILED: No HTML superscripts found');
  }
}
