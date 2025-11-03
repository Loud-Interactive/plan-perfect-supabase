#!/usr/bin/env node

import { createHmac } from 'crypto'
import { readFileSync, writeFileSync } from 'fs'

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
const WEBHOOK_SECRET = 'MDAdVT7rXYThlWUz6h/kwbKYsotGcFOfyPqBI30ojvUA1qHb6dF1dx5oddaSnib1'

console.log('📥 Fetching real task data from Supabase...')

// Fetch the actual task
const response = await fetch(`${SUPABASE_URL}/rest/v1/tasks?task_id=eq.ae1c8678-4178-4fe9-888a-2674af83a959&select=*`, {
  headers: {
    'apikey': SERVICE_KEY,
    'Authorization': `Bearer ${SERVICE_KEY}`
  }
})

const tasks = await response.json()
if (!tasks || tasks.length === 0) {
  console.error('❌ Task not found')
  process.exit(1)
}

const task = tasks[0]

console.log('✓ Task fetched successfully')
console.log(`  Title: ${task.title}`)
console.log(`  Status: ${task.status}`)

// Construct the exact payload as sent by the webhook
const payload = {
  guid: task.task_id,
  event: 'content_complete',
  timestamp: new Date().toISOString(),
  data: {
    status: task.status || 'Unknown',
    title: task.title || '',
    slug: task.title ? task.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : '',
    client_domain: task.client_domain || '',
    html_link: task.html_link,
    google_doc_link: task.google_doc_link,
    content: task.content || task.post_html,
    seo_keyword: task.seo_keyword,
    meta_description: task.meta_description,
    live_post_url: task.live_post_url
  }
}

// Generate compact JSON
const payloadString = JSON.stringify(payload)

console.log('')
console.log('📊 Payload Statistics:')
console.log(`  Total size: ${(payloadString.length / 1024).toFixed(2)} KB`)
console.log(`  Content size: ${task.content ? (task.content.length / 1024).toFixed(2) : '0'} KB`)

// Generate signature
const hmac = createHmac('sha256', WEBHOOK_SECRET)
hmac.update(payloadString)
const signature = hmac.digest('hex')

console.log('')
console.log('🔐 Signature Generated:')
console.log(`  sha256=${signature}`)

// Save payload to file
writeFileSync('actual-payload-complete.json', JSON.stringify(payload, null, 2))
console.log('')
console.log('✓ Saved formatted payload to: actual-payload-complete.json')

// Save compact payload (as sent)
writeFileSync('actual-payload-compact.json', payloadString)
console.log('✓ Saved compact payload (as sent) to: actual-payload-compact.json')

// Save signature info
const info = `CENTR WEBHOOK - ACTUAL PAYLOAD TEST DATA
========================================

Task ID: ${task.task_id}
Title: ${task.title}
Generated: ${new Date().toISOString()}

PAYLOAD SIZE:
- Total: ${(payloadString.length / 1024).toFixed(2)} KB
- Content only: ${task.content ? (task.content.length / 1024).toFixed(2) : '0'} KB

SIGNATURE:
sha256=${signature}

SECRET USED:
${WEBHOOK_SECRET}

FILES GENERATED:
1. actual-payload-complete.json - Formatted (readable)
2. actual-payload-compact.json - Compact (exactly as sent)
3. signature-info.txt - This file

TO TEST ON CENTR SIDE:
1. Read actual-payload-compact.json
2. Compute HMAC-SHA256 with the secret above
3. Compare with the signature above
4. They should match exactly

If they don't match, there's either:
- A different secret being used
- A different payload format expected
- Additional normalization/escaping happening
`

writeFileSync('signature-info.txt', info)
console.log('✓ Saved signature info to: signature-info.txt')

console.log('')
console.log('📧 Share these files with Erik:')
console.log('  1. actual-payload-compact.json (the exact bytes we send)')
console.log('  2. signature-info.txt (signature + instructions)')
console.log('')
console.log('✅ Done!')

