// Verify HTML structure for task 73ed7d1d-9c1f-4208-a2ff-bd0cf56960f2
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = 'https://jsypctdhynsdqrfifvdh.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpzeXBjdGRoeW5zZHFyZmlmdmRoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0MDY5MjAzMiwiZXhwIjoyMDU2MjY4MDMyfQ.19Eds9LcZbb-rwLCpPJsk7kMIa7eTU7wIw_-Yn_iyG8';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const taskId = '73ed7d1d-9c1f-4208-a2ff-bd0cf56960f2';

const { data, error } = await supabase
  .from('tasks')
  .select('post_html, post_json, unedited_content')
  .eq('task_id', taskId)
  .single();

if (error) {
  console.error('Error:', error);
  Deno.exit(1);
}

// Check markdown structure
console.log('=== MARKDOWN STRUCTURE ===');
const h2Count = (data.unedited_content.match(/^## /gm) || []).length;
const h3Count = (data.unedited_content.match(/^### /gm) || []).length;
console.log(`H2 headings (##): ${h2Count}`);
console.log(`H3 headings (###): ${h3Count}`);

// Check JSON structure
console.log('\n=== JSON STRUCTURE ===');
const json = typeof data.post_json === 'string' ? JSON.parse(data.post_json) : data.post_json;
console.log(`Sections: ${json.sections?.length || 0}`);

let totalSubsections = 0;
if (json.sections) {
  json.sections.forEach((section, i) => {
    const subsections = section.subsections?.length || 0;
    totalSubsections += subsections;
    console.log(`  Section ${i + 1} "${section.heading}": ${subsections} subsections`);
  });
}
console.log(`Total subsections: ${totalSubsections}`);

// Check HTML structure
console.log('\n=== HTML STRUCTURE ===');
const h2HtmlCount = (data.post_html.match(/<h2[^>]*>/g) || []).length;
const h3HtmlCount = (data.post_html.match(/<h3[^>]*>/g) || []).length;
console.log(`H2 tags: ${h2HtmlCount}`);
console.log(`H3 tags: ${h3HtmlCount}`);

// Extract first few H2 and H3 headings from HTML
const h2Matches = data.post_html.match(/<h2[^>]*>(.*?)<\/h2>/g);
const h3Matches = data.post_html.match(/<h3[^>]*>(.*?)<\/h3>/g);

if (h2Matches) {
  console.log('\n=== First 5 H2 Headings ===');
  h2Matches.slice(0, 5).forEach((match, i) => {
    const text = match.replace(/<[^>]+>/g, '').trim();
    console.log(`${i + 1}. ${text}`);
  });
}

if (h3Matches) {
  console.log('\n=== First 10 H3 Headings ===');
  h3Matches.slice(0, 10).forEach((match, i) => {
    const text = match.replace(/<[^>]+>/g, '').trim();
    console.log(`${i + 1}. ${text}`);
  });
}
