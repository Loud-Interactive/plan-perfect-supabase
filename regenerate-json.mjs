#!/usr/bin/env node

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jsypctdhynsdqrfifvdh.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const contentPlanOutlineGuid = 'fa4846f4-9391-4991-ba86-4717527e80b3';

console.log(`\n🔄 Regenerating JSON from markdown for content_plan_outline_guid: ${contentPlanOutlineGuid}\n`);

const response = await fetch(`${SUPABASE_URL}/functions/v1/markdown-to-rich-json`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
  },
  body: JSON.stringify({
    content_plan_outline_guid: contentPlanOutlineGuid
  })
});

const result = await response.json();

if (response.ok) {
  console.log('✅ JSON regenerated successfully');
  console.log(`   Title: ${result.title}`);
  console.log(`   Sections: ${result.sections?.length || 0}`);
  
  // Check if subsections now have titles
  if (result.sections) {
    let subsectionsWithTitles = 0;
    let subsectionsWithoutTitles = 0;
    result.sections.forEach((section, i) => {
      section.subsections?.forEach((sub) => {
        if (sub.heading || sub.title) {
          subsectionsWithTitles++;
        } else {
          subsectionsWithoutTitles++;
        }
      });
    });
    console.log(`   Subsections with titles: ${subsectionsWithTitles}`);
    console.log(`   Subsections without titles: ${subsectionsWithoutTitles}`);
  }
} else {
  console.error('❌ Error:', result);
  process.exit(1);
}
