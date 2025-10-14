// Check the outline structure for f3513fac-e02a-4896-8c6c-2228319653e2
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = 'https://jsypctdhynsdqrfifvdh.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpzeXBjdGRoeW5zZHFyZmlmdmRoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0MDY5MjAzMiwiZXhwIjoyMDU2MjY4MDMyfQ.19Eds9LcZbb-rwLCpPJsk7kMIa7eTU7wIw_-Yn_iyG8';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const outlineGuid = 'f3513fac-e02a-4896-8c6c-2228319653e2';

const { data, error } = await supabase
  .from('content_plan_outlines')
  .select('outline')
  .eq('guid', outlineGuid)
  .single();

if (error) {
  console.error('Error:', error);
  Deno.exit(1);
}

let sections = [];
if (data.outline) {
  const outlineJson = typeof data.outline === 'string'
    ? JSON.parse(data.outline)
    : data.outline;
  sections = outlineJson.sections || [];
}

console.log('=== OUTLINE STRUCTURE ===');
console.log(`Total sections: ${sections.length}\n`);

sections.forEach((section, i) => {
  console.log(`${i + 1}. ${section.title}`);
  if (section.subheadings && section.subheadings.length > 0) {
    section.subheadings.forEach((sub, j) => {
      console.log(`   ${j + 1}. ${sub}`);
    });
  }
  console.log('');
});
