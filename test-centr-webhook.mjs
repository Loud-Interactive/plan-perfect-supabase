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

console.log('\n🧪 Testing Centr Webhook Integration')
console.log('═══════════════════════════════════════\n')

// Test with a real task from shop.centr.com (from successful synopsis job)
const testPayload = {
  task_id: 'centr-webhook-test-' + Date.now(),
  status: 'completed',
  title: 'Test Article: Centr Fitness Guide',
  slug: 'test-article-centr-fitness-guide',
  domain: 'centr.com',  // Match the webhook domain
  seo_keyword: 'fitness guide',
  meta_description: 'Complete guide to fitness and wellness from Centr experts',
  live_post_url: 'https://shop.centr.com/blog/fitness-guide',  // URL can be shop.centr.com
  html_link: 'https://docs.google.com/document/d/test-doc-id',
  content: 'This is a test article about fitness and wellness. Complete guide with expert advice.',
  client_domain: 'centr.com'
}

console.log('📤 Sending test webhook for shop.centr.com...')
console.log(`   Task ID: ${testPayload.task_id}`)
console.log(`   Status: ${testPayload.status}\n`)

const response = await fetch(`${SUPABASE_URL}/functions/v1/update-task-status`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(testPayload)
})

const result = await response.json()

console.log(`📥 Response Status: ${response.status} ${response.statusText}`)
console.log(`📦 Response Body:`)
console.log(JSON.stringify(result, null, 2))

if (response.ok) {
  console.log('\n✅ Update successful!')
  
  if (result.webhooks_sent && result.webhooks_sent > 0) {
    console.log(`🎯 ${result.webhooks_sent} webhook(s) sent`)
  } else {
    console.log('⚠️  No webhooks were sent (may not be registered for this domain)')
  }
} else {
  console.log('\n❌ Update failed')
}

console.log('\n═══════════════════════════════════════\n')
console.log('💡 Check edge function logs for details:')
console.log('   Dashboard: https://supabase.com/dashboard/project/jsypctdhynsdqrfifvdh/functions')
console.log('\n')

