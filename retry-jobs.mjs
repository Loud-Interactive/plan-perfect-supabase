#!/usr/bin/env node

/**
 * Retry failed outline generation jobs
 * Usage: SUPABASE_SERVICE_ROLE_KEY=your_key node retry-jobs.mjs
 */

const SUPABASE_URL = 'https://jsypctdhynsdqrfifvdh.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error('❌ Error: SUPABASE_SERVICE_ROLE_KEY environment variable not set');
  console.error('Usage: SUPABASE_SERVICE_ROLE_KEY=your_key node retry-jobs.mjs');
  process.exit(1);
}

const failedJobs = [
  {
    id: "7803d76a-ae6f-4db6-8fb3-125096ca41b4",
    post_title: "Financial Aid 101: Everything You Need to Know About FAFSA",
    post_keyword: "financial aid"
  },
  {
    id: "1935c137-0cfc-4344-9c91-2449c98571cc",
    post_title: "What Is FAFSA? A Step-by-Step Overview of the Application Process",
    post_keyword: "what is fafsa"
  },
  {
    id: "10f9010b-9bcc-441f-8c1a-916043a212d3",
    post_title: "Financial Aid 101: Everything You Need to Know About FAFSA",
    post_keyword: "financial aid"
  },
  {
    id: "ca604ff0-7195-4ec6-b5de-f417344cb34f",
    post_title: "What Is FAFSA? A Step-by-Step Overview of the Application Process",
    post_keyword: "what is fafsa"
  }
];

async function retryJobs() {
  console.log(`🔄 Retrying ${failedJobs.length} failed jobs...\n`);

  for (const job of failedJobs) {
    console.log(`📝 Processing job: ${job.id}`);
    console.log(`   Title: ${job.post_title}`);
    console.log(`   Keyword: ${job.post_keyword}`);

    try {
      // Step 1: Reset job status to pending
      console.log(`   ⏳ Resetting status to pending...`);
      const resetResponse = await fetch(`${SUPABASE_URL}/rest/v1/outline_generation_jobs?id=eq.${job.id}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'apikey': SUPABASE_SERVICE_KEY,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          status: 'pending',
          updated_at: new Date().toISOString(),
          attempts: 0
        })
      });

      if (!resetResponse.ok) {
        const errorText = await resetResponse.text();
        console.log(`   ❌ Failed to reset status: ${errorText}`);
        continue;
      }

      console.log(`   ✅ Status reset to pending`);

      // Step 2: Wait a moment
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Step 3: Trigger fast-outline-search
      console.log(`   🚀 Triggering fast-outline-search...`);
      const triggerResponse = await fetch(`${SUPABASE_URL}/functions/v1/fast-outline-search`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ job_id: job.id })
      });

      if (!triggerResponse.ok) {
        const errorText = await triggerResponse.text();
        console.log(`   ❌ Failed to trigger: ${errorText}`);
        continue;
      }

      const result = await triggerResponse.json();
      console.log(`   ✅ Triggered successfully: ${result.message}`);
      console.log('');

    } catch (error) {
      console.log(`   ❌ Error: ${error.message}`);
      console.log('');
    }

    // Wait between jobs
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  console.log('✅ Done! All jobs have been reprocessed.');
  console.log('\n💡 Monitor job progress in Supabase dashboard or check with SQL:');
  console.log('   SELECT id, post_keyword, status, updated_at');
  console.log('   FROM outline_generation_jobs');
  console.log('   WHERE id IN (');
  failedJobs.forEach((job, idx) => {
    console.log(`     '${job.id}'${idx < failedJobs.length - 1 ? ',' : ''}`);
  });
  console.log('   );');
}

retryJobs().catch(console.error);
