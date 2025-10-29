#!/usr/bin/env node

import { readFileSync } from 'fs'

// Parse .env file
const envContent = readFileSync('.env', 'utf-8')
const envVars = {}
envContent.split('\n').forEach(line => {
  const match = line.match(/^([^=]+)=(.*)$/)
  if (match) {
    envVars[match[1]] = match[2].replace(/^["']|["']$/g, '')
  }
})

const SUPABASE_URL = envVars.SUPABASE_URL
const SERVICE_KEY = envVars.SUPABASE_SERVICE_ROLE_KEY
const FINALIZER_URL = `${SUPABASE_URL}/functions/v1/synopsis-finalizer`

const failedJobs = [
  {"id":"5af36456-7bc6-43d0-a2e9-78dd33417224","domain":"shop.centr.com","error_message":"Analysis failed: Finalizer trigger failed: 500"},
  {"id":"750121e7-80b2-46a2-9458-9a4c14f9b1d2","domain":"elainemaimon.com","error_message":"Analysis failed: Finalizer trigger failed: 500"},
  {"id":"4c405585-7e0e-4c34-bbb0-d7cce944132a","domain":"airportshuttlelasvegas.com","error_message":"Analysis failed: Finalizer trigger failed: 500"},
  {"id":"04dc59ca-1d91-455a-a926-3712665b3b25","domain":"absolutedental.com","error_message":"Analysis failed: Finalizer trigger failed: 500"},
  {"id":"0a702c33-91d1-40c5-8cc1-1464dd890fa2","domain":"bernsteinandmaryanoff.com","error_message":"Analysis failed: Finalizer trigger failed: 500"},
  {"id":"7911b67d-cc56-414b-ac9d-5fe94d09a759","domain":"experiencezuzu.com","error_message":"Analysis failed: Finalizer trigger failed: 500"},
  {"id":"2d09f32c-efa6-433b-84e3-2aeac11da1ba","domain":"yamworldit.com","error_message":"Analysis failed: Finalizer trigger failed: 500"},
  {"id":"354d7858-e128-4b35-a317-cf794d7eb214","domain":"hire525.com","error_message":"Analysis failed: Finalizer trigger failed: 500"},
  {"id":"03aa647e-f4c6-43aa-b56f-ed95dc319e73","domain":"settelawoffice.com","error_message":"Analysis failed: Finalizer trigger failed: 500"},
  {"id":"67a1bee5-8e5c-48ab-b9f6-900f25f0230f","domain":"experience220.com","error_message":"Analysis failed: Finalizer trigger failed: 500"},
  {"id":"3577a14c-0f3b-4c25-be6c-82668aa8f21d","domain":"sunrisechildren.org","error_message":"Analysis failed: Finalizer trigger failed: 500"},
  {"id":"81a9f7e6-c272-487b-b0b4-654bc8bdc50d","domain":"deluca-associates.com","error_message":"Fast crawler failed: Unable to locate <final_answer> block in Groq response"},
  {"id":"26f4224e-2ea0-4bfa-8b6a-fa159482429e","domain":"clubdesoleil.com","error_message":"Analysis failed: Finalizer trigger failed: 500"},
  {"id":"9de022e6-6563-4696-8205-e4b4a2350e80","domain":"rrms.com","error_message":"Analysis failed: Finalizer trigger failed: 500"},
  {"id":"df0e17ba-8b73-4c67-931b-2872ad9baecc","domain":"parcdetroit.com","error_message":"Fast crawler failed: Unable to locate <final_answer> block in Groq response"},
  {"id":"d9d57d63-33bd-484e-a8d4-090bbc2a7fe5","domain":"englishanyone.com","error_message":"Analysis failed: Finalizer trigger failed: 500"},
  {"id":"85b827d8-dd87-43b9-abb1-5250ff6d9fa2","domain":"aqualv.com","error_message":"Analysis failed: Finalizer trigger failed: 500"},
  {"id":"c7b15f19-c08a-4512-95c9-3f1b195e7d17","domain":"thechateau.com","error_message":"Analysis failed: Finalizer trigger failed: 500"},
  {"id":"87327056-ce6a-493b-8a8b-d4b14fda6983","domain":"tahitiresortlv.com","error_message":"Analysis failed: Finalizer trigger failed: 500"},
  {"id":"9016e254-9a7d-406c-a0ed-a214561ea95a","domain":"tahitivillage.com","error_message":"Analysis failed: Finalizer trigger failed: 500"},
  {"id":"29fd415a-9079-445a-a141-bb29618d4086","domain":"kylebachus.com","error_message":"Analysis failed: Finalizer trigger failed: 500"},
  {"id":"5f274bbb-a350-46e4-939d-1a898f6bca3a","domain":"caviarbarlv.com","error_message":"Fast crawler failed: Unable to locate <final_answer> block in Groq response"},
  {"id":"5f314fa1-c92d-4aaa-aefc-fde8ffabef1f","domain":"eastbankdev.com","error_message":"Analysis failed: Finalizer trigger failed: 500"}
]

// Separate by failure type
const finalizerFailures = failedJobs.filter(j => j.error_message.includes('Finalizer trigger failed'))
const crawlerFailures = failedJobs.filter(j => j.error_message.includes('Fast crawler failed'))

console.log(`\n📊 FAILED JOBS SUMMARY`)
console.log(`═══════════════════════════════════════`)
console.log(`Total failed jobs: ${failedJobs.length}`)
console.log(`  ├─ Finalizer failures: ${finalizerFailures.length}`)
console.log(`  └─ Crawler failures: ${crawlerFailures.length}`)
console.log(`\n`)

async function retryFinalizerJob(job, index, total) {
  console.log(`\n[${index + 1}/${total}] Retrying finalizer for ${job.domain}...`)
  console.log(`  Job ID: ${job.id}`)
  
  try {
    const response = await fetch(FINALIZER_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ job_id: job.id })
    })
    
    const result = await response.json()
    
    if (result.success) {
      console.log(`  ✅ SUCCESS - Processed ${result.analysis_tasks_processed} tasks`)
      console.log(`  📦 Pairs stored: ${Object.keys(result.pairs_upserted || {}).length}`)
      return { success: true, job, result }
    } else {
      console.log(`  ❌ FAILED - ${result.error}`)
      return { success: false, job, error: result.error }
    }
  } catch (error) {
    console.log(`  ❌ ERROR - ${error.message}`)
    return { success: false, job, error: error.message }
  }
}

async function retryCrawlerJob(job, index, total) {
  console.log(`\n[${index + 1}/${total}] ⚠️  SKIPPING crawler failure: ${job.domain}`)
  console.log(`  Job ID: ${job.id}`)
  console.log(`  Reason: ${job.error_message}`)
  console.log(`  ℹ️  These jobs need full re-crawling (not implemented in this script)`)
  return { success: false, job, error: 'Crawler failures require full retry', skipped: true }
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Main execution
async function main() {
  const results = {
    finalizer: {
      success: [],
      failed: []
    },
    crawler: {
      skipped: []
    }
  }
  
  // Retry finalizer failures
  if (finalizerFailures.length > 0) {
    console.log(`\n🔄 RETRYING FINALIZER FAILURES`)
    console.log(`═══════════════════════════════════════\n`)
    
    for (let i = 0; i < finalizerFailures.length; i++) {
      const job = finalizerFailures[i]
      const result = await retryFinalizerJob(job, i, finalizerFailures.length)
      
      if (result.success) {
        results.finalizer.success.push(result)
      } else {
        results.finalizer.failed.push(result)
      }
      
      // Wait 2 seconds between retries to avoid overwhelming the system
      if (i < finalizerFailures.length - 1) {
        await sleep(2000)
      }
    }
  }
  
  // Handle crawler failures
  if (crawlerFailures.length > 0) {
    console.log(`\n\n⚠️  CRAWLER FAILURES`)
    console.log(`═══════════════════════════════════════\n`)
    
    for (let i = 0; i < crawlerFailures.length; i++) {
      const job = crawlerFailures[i]
      const result = await retryCrawlerJob(job, i, crawlerFailures.length)
      results.crawler.skipped.push(result)
    }
  }
  
  // Print summary
  console.log(`\n\n📈 FINAL RESULTS`)
  console.log(`═══════════════════════════════════════`)
  console.log(`\nFinalizer Jobs:`)
  console.log(`  ✅ Successful: ${results.finalizer.success.length}`)
  console.log(`  ❌ Failed: ${results.finalizer.failed.length}`)
  
  if (results.finalizer.failed.length > 0) {
    console.log(`\n  Failed jobs:`)
    results.finalizer.failed.forEach(r => {
      console.log(`    • ${r.job.domain} (${r.job.id})`)
      console.log(`      Error: ${r.error}`)
    })
  }
  
  console.log(`\nCrawler Jobs:`)
  console.log(`  ⏭️  Skipped: ${results.crawler.skipped.length}`)
  
  if (results.crawler.skipped.length > 0) {
    console.log(`\n  Skipped domains (need full re-crawl):`)
    results.crawler.skipped.forEach(r => {
      console.log(`    • ${r.job.domain}`)
    })
  }
  
  console.log(`\n✨ Script complete!`)
  console.log(`═══════════════════════════════════════\n`)
}

main().catch(console.error)

