// Save test files
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = 'https://jsypctdhynsdqrfifvdh.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpzeXBjdGRoeW5zZHFyZmlmdmRoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0MDY5MjAzMiwiZXhwIjoyMDU2MjY4MDMyfQ.19Eds9LcZbb-rwLCpPJsk7kMIa7eTU7wIw_-Yn_iyG8';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const taskId = '73ed7d1d-9c1f-4208-a2ff-bd0cf56960f2';

const { data, error } = await supabase
  .from('tasks')
  .select('unedited_content, post_json, post_html')
  .eq('task_id', taskId)
  .single();

if (error) {
  console.error('Error:', error);
  Deno.exit(1);
}

// Save markdown
await Deno.writeTextFile('/Users/martinbowling/Downloads/test-markdown.md', data.unedited_content);
console.log('✅ Saved markdown to /Users/martinbowling/Downloads/test-markdown.md');

// Save JSON (pretty print)
const json = typeof data.post_json === 'string' ? JSON.parse(data.post_json) : data.post_json;
await Deno.writeTextFile('/Users/martinbowling/Downloads/test-json.json', JSON.stringify(json, null, 2));
console.log('✅ Saved JSON to /Users/martinbowling/Downloads/test-json.json');

// Save HTML
await Deno.writeTextFile('/Users/martinbowling/Downloads/test-html.html', data.post_html);
console.log('✅ Saved HTML to /Users/martinbowling/Downloads/test-html.html');

// Quick analysis
console.log('\n=== QUICK ANALYSIS ===');
const markdownRefs = (data.unedited_content.match(/\[\d+\]/g) || []).length;
console.log('Markdown references:', markdownRefs);

const jsonStr = JSON.stringify(json);
const jsonRefs = (jsonStr.match(/\[\d+\]/g) || []).length;
console.log('JSON references:', jsonRefs);

const htmlRefs = (data.post_html.match(/<sup><a href="#ref\d+"[^>]*>\d+<\/a><\/sup>/g) || []).length;
console.log('HTML reference citations:', htmlRefs);

const sectionCount = json.sections ? json.sections.length : 0;
const refCount = json.references ? json.references.length : 0;
console.log('\nJSON sections:', sectionCount);
console.log('JSON references array:', refCount);
