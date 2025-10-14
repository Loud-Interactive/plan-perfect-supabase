#!/usr/bin/env node

/**
 * Retry all 9 Chris Hemsworth outline generation jobs (fast mode)
 * Usage: SUPABASE_SERVICE_ROLE_KEY=your_key node retry-chris-hemsworth-all.mjs
 */

const SUPABASE_URL = 'https://jsypctdhynsdqrfifvdh.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error('❌ Error: SUPABASE_SERVICE_ROLE_KEY environment variable not set');
  console.error('Usage: SUPABASE_SERVICE_ROLE_KEY=your_key node retry-chris-hemsworth-all.mjs');
  process.exit(1);
}

const jobsToRetry = [
  {
    id: "abdcf20e-aaef-49b3-9808-19690c57bd4b",
    post_title: "Chris Hemsworth Thor Workout: How He Trains for the MCU",
    post_keyword: "chris hemsworth thor workout"
  },
  {
    id: "4231499e-c238-46ae-9838-2079dba7c83c",
    post_title: "Ultimate Chris Hemsworth Workout Routine: How to Build a Superhero Physique",
    post_keyword: "chris hemsworth workout routine"
  },
  {
    id: "250d04a6-2f99-4051-9dcf-a017409dfb50",
    post_title: "Chris Hemsworth Protein Intake: How Much He Consumes for Muscle",
    post_keyword: "chris hemsworth protein intake"
  },
  {
    id: "0b88cd27-2027-44f0-b189-133440e4f556",
    post_title: "Chris Hemsworth Fitness Routine: Day-by-Day Training Plan",
    post_keyword: "chris hemsworth fitness routine"
  },
  {
    id: "714986a2-ec4e-4df5-aa0d-b563509697e1",
    post_title: "Chris Hemsworth Gym Workout: Exercises He Swears By",
    post_keyword: "chris hemsworth gym workout"
  },
  {
    id: "8019b1fa-51a7-41bd-84cc-04cbc539d20c",
    post_title: "Chris Hemsworth Meals: What the Actor Eats in a Day",
    post_keyword: "chris hemsworth meals"
  },
  {
    id: "13193899-5e86-42bd-935d-292951b1d9ef",
    post_title: "Chris Hemsworth Diet Secrets: Tips for Staying Shredded Year-Round",
    post_keyword: "chris hemsworth diet secrets"
  },
  {
    id: "89480933-e737-40a5-865c-079d257aa250",
    post_title: "Chris Hemsworth Muscle Workout: Targeted Moves for Mass",
    post_keyword: "chris hemsworth muscle workout"
  },
  {
    id: "bf3a49c0-8097-4163-94d3-4832620c232a",
    post_title: "Chris Hemsworth Nutrition: Key Macronutrients He Prioritizes",
    post_keyword: "chris hemsworth nutrition"
  }
];

async function retryJobs() {
  console.log(`🔄 Retrying ${jobsToRetry.length} Chris Hemsworth jobs in FAST MODE...\n`);
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
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  console.log('✅ Done! All Chris Hemsworth jobs have been reprocessed in FAST MODE.');
  console.log('\n⚡ Expected completion: 2-5 minutes per job (using Groq)');
  console.log('\n💡 Monitor job progress in Supabase dashboard or check with SQL:');
  console.log('   SELECT id, post_keyword, status, fast_mode, updated_at');
  console.log('   FROM outline_generation_jobs');
  console.log('   WHERE content_plan_guid = \'926d211d-323f-4f8f-9e85-a9adf7324b63\'');
  console.log('   ORDER BY updated_at DESC;');
}

retryJobs().catch(console.error);
