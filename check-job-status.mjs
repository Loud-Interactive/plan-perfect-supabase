import { createClient } from 'npm:@supabase/supabase-js@2';

const supabase = createClient(
  'https://jsypctdhynsdqrfifvdh.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

console.log('Checking outline generation job status...\n');

// Check recent job statuses
const { data: jobs, error: jobError } = await supabase
  .from('outline_generation_jobs')
  .select('id, post_keyword, status, fast_mode, updated_at')
  .in('content_plan_guid', [
    '503cf6b2-93e9-455e-8ea7-6d3cd7d0e347', // Fractional CMO
    '926d211d-323f-4f8f-9e85-a9adf7324b63'  // Chris Hemsworth
  ])
  .order('updated_at', { ascending: false })
  .limit(10);

if (jobError) {
  console.error('Error fetching jobs:', jobError);
  process.exit(1);
}

console.log('Recent job statuses:');
const statusCounts = {};
jobs.forEach(job => {
  const age = Math.round((Date.now() - new Date(job.updated_at).getTime()) / 1000);
  console.log(`  ${job.status.padEnd(25)} ${job.post_keyword.substring(0, 30).padEnd(32)} (${age}s ago)`);
  statusCounts[job.status] = (statusCounts[job.status] || 0) + 1;
});

console.log('\nStatus summary:');
Object.entries(statusCounts).forEach(([status, count]) => {
  console.log(`  ${status}: ${count}`);
});

// Check if any outlines were saved
const { data: outlines, error: outlineError } = await supabase
  .from('content_plan_outlines')
  .select('guid, post_title, status, updated_at')
  .order('updated_at', { ascending: false })
  .limit(5);

console.log('\nRecent content_plan_outlines:');
if (outlines && outlines.length > 0) {
  outlines.forEach(o => {
    const age = Math.round((Date.now() - new Date(o.updated_at).getTime()) / 1000 / 60);
    console.log(`  ${o.guid} - ${(o.post_title || '').substring(0, 40).padEnd(42)} (${age}m ago)`);
  });
} else {
  console.log('  No recent outlines found in content_plan_outlines table');
}

// Check for failed jobs
const { data: failedJobs } = await supabase
  .from('outline_generation_jobs')
  .select('id, post_keyword, status')
  .eq('status', 'failed')
  .in('content_plan_guid', [
    '503cf6b2-93e9-455e-8ea7-6d3cd7d0e347',
    '926d211d-323f-4f8f-9e85-a9adf7324b63'
  ]);

if (failedJobs && failedJobs.length > 0) {
  console.log(`\n⚠️  ${failedJobs.length} jobs failed`);
}