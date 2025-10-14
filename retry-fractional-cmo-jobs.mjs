#!/usr/bin/env node

/**
 * Retry fractional CMO outline generation jobs (fast mode)
 * Usage: SUPABASE_SERVICE_ROLE_KEY=your_key node retry-fractional-cmo-jobs.mjs
 */

const SUPABASE_URL = 'https://jsypctdhynsdqrfifvdh.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error('❌ Error: SUPABASE_SERVICE_ROLE_KEY environment variable not set');
  console.error('Usage: SUPABASE_SERVICE_ROLE_KEY=your_key node retry-fractional-cmo-jobs.mjs');
  process.exit(1);
}

const jobsToRetry = [
  {
    id: "33b9756c-079e-4f3f-b66c-b0a71a167e5e",
    post_title: "Fractional CMO vs Marketing Consultant: What You Need to Know",
    post_keyword: "fractional cmo vs marketing consultant"
  },
  {
    id: "48f68114-0b42-45a6-9ec3-54c648e1aa59",
    post_title: "How to Hire a Fractional CMO: A Step-by-Step Guide",
    post_keyword: "how to hire a fractional cmo"
  },
  {
    id: "a73e0add-649a-4631-8666-af0bb4079273",
    post_title: "Fractional CMO Cost: What to Expect and How to Budget",
    post_keyword: "fractional cmo cost"
  },
  {
    id: "b0b55b39-681e-4e2f-8410-45ce1101fe59",
    post_title: "Fractional CMO Services: Unlock Strategic Marketing Leadership on Demand",
    post_keyword: "Fractional CMO services"
  },
  {
    id: "c8ba3cc9-a584-479b-9459-2b7d8f427dba",
    post_title: "Fractional CMO Services: Unlock Strategic Marketing Leadership on Demand",
    post_keyword: "Fractional CMO services"
  },
  {
    id: "09f421b9-2584-4690-84ad-33b3d19a7cd4",
    post_title: "Fractional CMO Services: Unlock Strategic Marketing Leadership on Demand",
    post_keyword: "Fractional CMO services"
  },
  {
    id: "870b245c-2ff4-4300-a2cb-cef9477dd789",
    post_title: "Fractional CMO Services: Unlock Strategic Marketing Leadership on Demand",
    post_keyword: "Fractional CMO services"
  },
  {
    id: "2d8f69c8-14c7-43c5-8299-003c81dd322a",
    post_title: "Fractional CMO Services: Unlock Strategic Marketing Leadership on Demand",
    post_keyword: "Fractional CMO services"
  },
  {
    id: "8a6f901b-8e7c-4603-8939-df061e8d4d92",
    post_title: "Fractional CMO Services: Unlock Strategic Marketing Leadership on Demand",
    post_keyword: "Fractional CMO services"
  },
  {
    id: "b7c9ee59-7517-4882-9893-08e29837d5ac",
    post_title: "Fractional CMO Services: Unlock Strategic Marketing Leadership on Demand",
    post_keyword: "Fractional CMO services"
  },
  {
    id: "c4c415d2-69d9-4fc2-93cc-31d5e2a779a7",
    post_title: "Fractional CMO vs Marketing Consultant: What You Need to Know",
    post_keyword: "fractional cmo vs marketing consultant"
  },
  {
    id: "739fcfb9-4cf2-49f5-a931-df653fc11a10",
    post_title: "Fractional CMO vs Marketing Consultant: What You Need to Know",
    post_keyword: "fractional cmo vs marketing consultant"
  },
  {
    id: "4c90675c-1ebc-4082-85a3-0ae94af2b0a6",
    post_title: "Top Benefits of Fractional CMO Services for Growing Companies",
    post_keyword: "benefits of fractional cmo services"
  },
  {
    id: "d710268e-8fd8-49e8-bbb9-4d8048d32a54",
    post_title: "Fractional CMO Services: Unlock Strategic Marketing Leadership on Demand",
    post_keyword: "Fractional CMO services"
  }
];

async function retryJobs() {
  console.log(`🔄 Retrying ${jobsToRetry.length} Fractional CMO jobs in FAST MODE...\n`);
  console.log('⚡ Note: These use Groq and will complete in 2-5 minutes each\n');

  for (const job of jobsToRetry) {
    console.log(`📝 Processing job: ${job.id}`);
    console.log(`   Title: ${job.post_title}`);
    console.log(`   Keyword: ${job.post_keyword}`);

    try {
      // Step 1: Reset job status to pending AND enable fast mode
      console.log(`   ⏳ Resetting status to pending and enabling FAST MODE...`);
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
          attempts: 0,
          heartbeat_at: null,
          fast_mode: true
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

      // Step 3: Trigger fast-outline-search (FAST MODE)
      console.log(`   🚀 Triggering fast-outline-search (FAST MODE with Groq)...`);
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
      console.log(`   ✅ Triggered successfully: ${result.message || 'Outline generation started'}`);
      console.log('');

    } catch (error) {
      console.log(`   ❌ Error: ${error.message}`);
      console.log('');
    }

    // Wait between jobs to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  console.log('✅ Done! All Fractional CMO jobs have been reprocessed in FAST MODE.');
  console.log('\n⚡ Expected completion: 2-5 minutes per job (using Groq)');
  console.log('\n💡 Monitor job progress in Supabase dashboard or check with SQL:');
  console.log('   SELECT id, post_keyword, status, fast_mode, heartbeat_at, updated_at');
  console.log('   FROM outline_generation_jobs');
  console.log('   WHERE content_plan_guid = \'503cf6b2-93e9-455e-8ea7-6d3cd7d0e347\'');
  console.log('   ORDER BY updated_at DESC;');
}

retryJobs().catch(console.error);
