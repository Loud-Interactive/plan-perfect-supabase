// Check the new task that was just created
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = 'https://jsypctdhynsdqrfifvdh.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpzeXBjdGRoeW5zZHFyZmlmdmRoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0MDY5MjAzMiwiZXhwIjoyMDU2MjY4MDMyfQ.19Eds9LcZbb-rwLCpPJsk7kMIa7eTU7wIw_-Yn_iyG8';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const taskId = '75e9aa5e-8c53-4d44-a945-e0ccebf39d86';

const { data, error } = await supabase
  .from('tasks')
  .select('title, status, unedited_content, post_json')
  .eq('task_id', taskId)
  .single();

if (error) {
  console.error('Error:', error);
  Deno.exit(1);
}

console.log('Title:', data.title);
console.log('Status:', data.status);
console.log('Markdown length:', data.unedited_content?.length || 0);

// Count headings in markdown
if (data.unedited_content) {
  const h2Count = (data.unedited_content.match(/^## /gm) || []).length;
  const h3Count = (data.unedited_content.match(/^### /gm) || []).length;
  console.log('\n=== MARKDOWN HEADINGS ===');
  console.log(`H2 headings (##): ${h2Count}`);
  console.log(`H3 headings (###): ${h3Count}`);

  console.log('\n=== First 1000 chars of markdown ===');
  console.log(data.unedited_content.substring(0, 1000));
}

// Check JSON structure
if (data.post_json) {
  const json = typeof data.post_json === 'string'
    ? JSON.parse(data.post_json)
    : data.post_json;

  console.log('\n=== JSON STRUCTURE ===');
  console.log('Number of sections:', json.sections?.length || 0);

  if (json.sections) {
    json.sections.forEach((section, i) => {
      console.log(`\nSection ${i + 1}: "${section.heading}"`);
      if (section.subsections) {
        section.subsections.forEach((sub, j) => {
          console.log(`  Subsection ${j + 1}: "${sub.heading || 'null'}"`);
        });
      }
    });
  }
}
