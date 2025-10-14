// Check references in markdown vs HTML
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = 'https://jsypctdhynsdqrfifvdh.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpzeXBjdGRoeW5zZHFyZmlmdmRoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0MDY5MjAzMiwiZXhwIjoyMDU2MjY4MDMyfQ.19Eds9LcZbb-rwLCpPJsk7kMIa7eTU7wIw_-Yn_iyG8';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const taskId = '73ed7d1d-9c1f-4208-a2ff-bd0cf56960f2';

const { data, error } = await supabase
  .from('tasks')
  .select('unedited_content, post_html, post_json')
  .eq('task_id', taskId)
  .single();

if (error) {
  console.error('Error:', error);
  Deno.exit(1);
}

const markdown = data.unedited_content;
const html = data.post_html;
const json = typeof data.post_json === 'string' ? JSON.parse(data.post_json) : data.post_json;

// Count reference citations in markdown
const markdownRefs = markdown.match(/\[\d+\]/g) || [];
const uniqueMarkdownRefs = new Set(markdownRefs.map(r => r.replace(/[\[\]]/g, '')));

console.log('=== MARKDOWN REFERENCES ===');
console.log(`Total reference citations: ${markdownRefs.length}`);
console.log(`Unique reference numbers: ${uniqueMarkdownRefs.size}`);
console.log(`References: [${Array.from(uniqueMarkdownRefs).sort((a, b) => parseInt(a) - parseInt(b)).join(', ')}]`);

// Count reference citations in HTML
const htmlRefs = html.match(/<sup><a href="#ref\d+"[^>]*>\d+<\/a><\/sup>/g) || [];
const uniqueHtmlRefs = new Set(
  htmlRefs.map(r => {
    const match = r.match(/ref(\d+)/);
    return match ? match[1] : null;
  }).filter(Boolean)
);

console.log('\n=== HTML REFERENCE CITATIONS ===');
console.log(`Total reference citations: ${htmlRefs.length}`);
console.log(`Unique reference numbers: ${uniqueHtmlRefs.size}`);
console.log(`References: [${Array.from(uniqueHtmlRefs).sort((a, b) => parseInt(a) - parseInt(b)).join(', ')}]`);

// Check reference section in HTML
const refSectionMatch = html.match(/<div id="references">[\s\S]*?<\/div>/);
if (refSectionMatch) {
  const refSection = refSectionMatch[0];
  const refItems = refSection.match(/<li id="ref\d+"/g) || [];
  console.log('\n=== HTML REFERENCE SECTION ===');
  console.log(`Reference items in bibliography: ${refItems.length}`);

  const refIds = refItems.map(item => {
    const match = item.match(/ref(\d+)/);
    return match ? match[1] : null;
  }).filter(Boolean);
  console.log(`Reference IDs: [${refIds.join(', ')}]`);
}

// Check JSON references
console.log('\n=== JSON REFERENCES ===');
if (json.references) {
  console.log(`References in JSON: ${json.references.length}`);
  json.references.forEach((ref, i) => {
    console.log(`  ${i + 1}. ${ref.citation || ref.url || 'No citation'}`);
  });
} else {
  console.log('No references array in JSON');
}

// Show sample of markdown with references
console.log('\n=== SAMPLE MARKDOWN WITH REFERENCES ===');
const lines = markdown.split('\n');
const linesWithRefs = lines.filter(line => line.match(/\[\d+\]/));
console.log(`Found ${linesWithRefs.length} lines with reference citations`);
if (linesWithRefs.length > 0) {
  console.log('\nFirst 5 lines with references:');
  linesWithRefs.slice(0, 5).forEach((line, i) => {
    console.log(`${i + 1}. ${line.substring(0, 150)}...`);
  });
}
