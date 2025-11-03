#!/usr/bin/env node

import { readFileSync } from 'fs'
import { randomUUID } from 'crypto'

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
const WEBHOOK_URL = 'https://uat.centr.com/webhooks/v1/loud-articles?code=sk_0wjgbMYDFkXscTeSze4rPvk96nliBIy1PnykQruamuQ='

console.log('🧪 Testing Webhook with Storage URL Solution')
console.log('═══════════════════════════════════════════════')
console.log('')

// Use the existing task
const taskId = 'ae1c8678-4178-4fe9-888a-2674af83a959'

console.log(`Triggering update-task-status for: ${taskId}`)
console.log('')

try {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/update-task-status`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      task_id: taskId,
      status: 'completed'
    })
  })

  const result = await response.json()
  console.log('Update Task Result:', result)
  console.log('')

  // Wait a bit then check webhook status
  console.log('Waiting 5 seconds for webhook processing...')
  await new Promise(resolve => setTimeout(resolve, 5000))

  const webhookResponse = await fetch(`${SUPABASE_URL}/rest/v1/webhooks?id=eq.90a96442-89cb-4a2c-bcef-1bb288e48d24&select=*`, {
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`
    }
  })

  const webhooks = await webhookResponse.json()
  const webhook = webhooks[0]

  console.log('')
  console.log('Webhook Status:')
  console.log(`  Last Called: ${webhook.last_called_at}`)
  console.log(`  Last Success: ${webhook.last_success_at}`)
  console.log(`  Last Failure: ${webhook.last_failure_at}`)
  console.log(`  Failure Reason: ${webhook.last_failure_reason}`)
  console.log(`  Is Active: ${webhook.is_active}`)
  console.log(`  Domain: ${webhook.domain}`)
  console.log(`  Events: ${webhook.events.join(', ')}`)
  console.log('')

  // Check if the HTML was uploaded to storage
  console.log('Checking storage...')
  const storageUrl = `https://jsypctdhynsdqrfifvdh.supabase.co/storage/v1/object/public/blogs/centr.com/${taskId}.html`
  
  const htmlCheck = await fetch(storageUrl)
  if (htmlCheck.ok) {
    console.log(`✅ HTML found in storage: ${storageUrl}`)
    const html = await htmlCheck.text()
    console.log(`   Size: ${(html.length / 1024).toFixed(2)} KB`)
  } else {
    console.log(`❌ HTML not found in storage: ${storageUrl}`)
    console.log(`   Status: ${htmlCheck.status}`)
  }

} catch (error) {
  console.error('❌ Error:', error.message)
}

