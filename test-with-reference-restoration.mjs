// Test the new reference restoration approach
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = 'https://jsypctdhynsdqrfifvdh.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpzeXBjdGRoeW5zZHFyZmlmdmRoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0MDY5MjAzMiwiZXhwIjoyMDU2MjY4MDMyfQ.19Eds9LcZbb-rwLCpPJsk7kMIa7eTU7wIw_-Yn_iyG8';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const taskId = '73ed7d1d-9c1f-4208-a2ff-bd0cf56960f2';
const outlineGuid = '62d12afb-d0b6-4ce6-a1e3-f1d6555a58d3';

console.log('🧪 Testing reference restoration approach...\n');

// Step 1: Clear post_json and post_html to force regeneration
console.log('Step 1: Clearing post_json and post_html...');
const { error: updateError } = await supabase
  .from('tasks')
  .update({ post_json: null, post_html: null })
  .eq('task_id', taskId);

if (updateError) {
  console.error('❌ Error clearing fields:', updateError);
  Deno.exit(1);
}
console.log('✅ Cleared post_json and post_html\n');

// Step 2: Call the function
console.log('Step 2: Calling generate-side-by-side...');
const response = await fetch(`${SUPABASE_URL}/functions/v1/generate-side-by-side`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ outline_guid: outlineGuid })
});

const result = await response.json();
console.log('Function response:', result);

if (!result.success) {
  console.error('❌ Function failed:', result.error);
  Deno.exit(1);
}
console.log('✅ Function completed successfully\n');

// Step 3: Fetch and analyze the results
console.log('Step 3: Fetching results...');
const { data, error } = await supabase
  .from('tasks')
  .select('unedited_content, post_json, post_html')
  .eq('task_id', taskId)
  .single();

if (error) {
  console.error('❌ Error fetching results:', error);
  Deno.exit(1);
}

// Save files
console.log('\nStep 4: Saving files...');
await Deno.writeTextFile('/Users/martinbowling/Downloads/test-markdown-new.md', data.unedited_content);
console.log('✅ Saved markdown to Downloads/test-markdown-new.md');

const json = typeof data.post_json === 'string' ? JSON.parse(data.post_json) : data.post_json;
await Deno.writeTextFile('/Users/martinbowling/Downloads/test-json-new.json', JSON.stringify(json, null, 2));
console.log('✅ Saved JSON to Downloads/test-json-new.json');

await Deno.writeTextFile('/Users/martinbowling/Downloads/test-html-new.html', data.post_html);
console.log('✅ Saved HTML to Downloads/test-html-new.html');

// Analyze reference counts
console.log('\n📊 REFERENCE ANALYSIS:');
const markdownRefs = (data.unedited_content.match(/\[\d+\]/g) || []).length;
const jsonRefs = (JSON.stringify(json).match(/\[\d+\]/g) || []).length;
const htmlRefs = (data.post_html.match(/<sup><a href="#ref\d+"[^>]*>\d+<\/a><\/sup>/g) || []).length;

console.log(`Markdown citations: ${markdownRefs}`);
console.log(`JSON citations:     ${jsonRefs}`);
console.log(`HTML citations:     ${htmlRefs}`);

if (jsonRefs === markdownRefs) {
  console.log('\n🎉 SUCCESS! All references restored from markdown to JSON!');
} else {
  console.log(`\n⚠️  WARNING: Reference mismatch! JSON has ${jsonRefs} but markdown has ${markdownRefs}`);
}

if (htmlRefs > 0) {
  console.log('✅ HTML has reference citations rendered');
} else {
  console.log('❌ HTML has no reference citations');
}
