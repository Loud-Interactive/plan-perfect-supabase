// Check outline structure for the fresh task
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = 'https://jsypctdhynsdqrfifvdh.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpzeXBjdGRoeW5zZHFyZmlmdmRoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0MDY5MjAzMiwiZXhwIjoyMDU2MjY4MDMyfQ.19Eds9LcZbb-rwLCpPJsk7kMIa7eTU7wIw_-Yn_iyG8';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const outlineGuid = '6139b555-7e63-4e6d-b161-0de3fee31aee';

console.log('Fetching outline structure...\n');

const { data, error } = await supabase
  .from('content_plan_outlines')
  .select('*')
  .eq('guid', outlineGuid)
  .single();

if (!data) {
  console.log('No outline found');
  Deno.exit(1);
}

console.log('\nAvailable columns:', Object.keys(data).join(', '));

// Try to find the outline sections field
let outlineSections = null;
if (data.outline_sections) {
  outlineSections = data.outline_sections;
} else if (data.sections) {
  outlineSections = data.sections;
} else if (data.outline) {
  outlineSections = data.outline;
}

if (!outlineSections) {
  console.log('\nCannot find outline sections in any expected field');
  Deno.exit(1);
}

if (error) {
  console.error('Error:', error);
  Deno.exit(1);
}

console.log('Post Title:', data.post_title);
console.log('\nOutline Sections:');

// Parse the outline data correctly
let sections = [];
if (data.outline) {
  const outlineJson = typeof data.outline === 'string'
    ? JSON.parse(data.outline)
    : data.outline;
  sections = outlineJson.sections || [];
} else {
  console.log('No outline data found!');
}

console.log(`\nFound ${sections.length} sections:\n`);

sections.forEach((section, i) => {
  console.log(`\nSection ${i + 1}: "${section.title}"`);
  if (section.subheadings && section.subheadings.length > 0) {
    section.subheadings.forEach((sub, j) => {
      console.log(`  Subheading ${j + 1}: "${sub || 'EMPTY STRING'}"`);
    });
  } else {
    console.log('  No subheadings defined');
  }
});
