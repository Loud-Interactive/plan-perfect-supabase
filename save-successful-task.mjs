// Save the successful task files for review
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = 'https://jsypctdhynsdqrfifvdh.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpzeXBjdGRoeW5zZHFyZmlmdmRoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0MDY5MjAzMiwiZXhwIjoyMDU2MjY4MDMyfQ.19Eds9LcZbb-rwLCpPJsk7kMIa7eTU7wIw_-Yn_iyG8';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const taskId = '73ed7d1d-9c1f-4208-a2ff-bd0cf56960f2';

console.log(`Fetching task ${taskId}...`);

const { data, error } = await supabase
  .from('tasks')
  .select('unedited_content, post_json, post_html')
  .eq('task_id', taskId)
  .single();

if (error) {
  console.error('Error:', error);
  Deno.exit(1);
}

console.log('Saving files to Downloads folder...\n');

// Save markdown
await Deno.writeTextFile('/Users/martinbowling/Downloads/test-markdown-final.md', data.unedited_content || 'null');
console.log('✅ Saved markdown to ~/Downloads/test-markdown-final.md');

// Save JSON
const jsonStr = typeof data.post_json === 'string' ? data.post_json : JSON.stringify(data.post_json, null, 2);
await Deno.writeTextFile('/Users/martinbowling/Downloads/test-json-final.json', jsonStr);
console.log('✅ Saved JSON to ~/Downloads/test-json-final.json');

// Save HTML
await Deno.writeTextFile('/Users/martinbowling/Downloads/test-html-final.html', data.post_html || 'null');
console.log('✅ Saved HTML to ~/Downloads/test-html-final.html');

// Count citations
const mdRefs = (data.unedited_content?.match(/\[(\d+)\]/g) || []).length;
const jsonRefs = (jsonStr.match(/\[(\d+)\]/g) || []).length;
const htmlRefs = (data.post_html?.match(/<sup><a href="#ref\d+"[^>]*>\d+<\/a><\/sup>/g) || []).length;

console.log('\n📊 Citation Counts:');
console.log(`   Markdown: ${mdRefs} citations`);
console.log(`   JSON:     ${jsonRefs} citations`);
console.log(`   HTML:     ${htmlRefs} superscripts`);

if (mdRefs === jsonRefs && jsonRefs === htmlRefs && htmlRefs === 60) {
  console.log('\n🎉 Perfect! All 60 citations preserved through the entire pipeline!');
} else {
  console.log('\n⚠️  Citation counts do not match');
}
