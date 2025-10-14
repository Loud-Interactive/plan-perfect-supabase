// Check task HTML for the fresh test
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = 'https://jsypctdhynsdqrfifvdh.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpzeXBjdGRoeW5zZHFyZmlmdmRoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0MDY5MjAzMiwiZXhwIjoyMDU2MjY4MDMyfQ.19Eds9LcZbb-rwLCpPJsk7kMIa7eTU7wIw_-Yn_iyG8';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const taskId = '79b56db9-4579-4c89-8d13-5e7a7871964e';

console.log('Fetching task data...\n');

const { data, error } = await supabase
  .from('tasks')
  .select('title, status, post_html, unedited_content, post_json')
  .eq('task_id', taskId)
  .single();

if (error) {
  console.error('Error:', error);
  Deno.exit(1);
}

console.log('Title:', data.title);
console.log('Status:', data.status);
console.log('Markdown length:', data.unedited_content?.length || 0);
console.log('HTML length:', data.post_html?.length || 0);

// Extract first 3000 chars of HTML to check subsection headings
if (data.post_html) {
  console.log('\n=== HTML Sample (first 3000 chars) ===');
  console.log(data.post_html.substring(0, 3000));

  // Look for H3 tags
  const h3Matches = data.post_html.match(/<h3[^>]*>(.*?)<\/h3>/g);
  if (h3Matches) {
    console.log('\n=== All H3 Headings Found ===');
    h3Matches.forEach((h3, i) => {
      const text = h3.replace(/<[^>]*>/g, '');
      console.log(`${i + 1}. ${text}`);
    });
  }
}

// Check JSON sections
if (data.post_json) {
  const json = typeof data.post_json === 'string'
    ? JSON.parse(data.post_json)
    : data.post_json;

  console.log('\n=== JSON Sections ===');
  console.log('Number of sections:', json.sections?.length || 0);
  json.sections?.forEach((section, i) => {
    console.log(`\nSection ${i + 1}: "${section.heading}"`);
    section.subsections?.forEach((sub, j) => {
      console.log(`  Subsection ${j + 1}: "${sub.heading}"`);
    });
  });
}
