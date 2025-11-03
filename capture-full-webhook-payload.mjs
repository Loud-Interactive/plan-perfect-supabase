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
const TASK_ID = 'ae1c8678-4178-4fe9-888a-2674af83a959'

console.log('📥 Fetching real task data...')

// Fetch the actual task
const response = await fetch(`${SUPABASE_URL}/rest/v1/tasks?task_id=eq.${TASK_ID}&select=*`, {
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
console.log(`✓ Task fetched: ${task.title}`)

// Generate slug
function generateSlug(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

// Step 1: Build payload WITHOUT signature
const timestamp = new Date().toISOString()
const payloadWithoutSignature = {
  guid: task.task_id,
  event: 'content_complete',
  timestamp: timestamp,
  data: {
    status: task.status || 'Unknown',
    title: task.title || '',
    slug: generateSlug(task.title || ''),
    client_domain: task.client_domain || '',
    html_link: task.html_link,
    google_doc_link: task.google_doc_link,
    content: task.content || task.post_html,
    seo_keyword: task.seo_keyword,
    meta_description: task.meta_description,
    live_post_url: task.live_post_url
  }
}

// Step 2: Generate signature from payload WITHOUT signature
const payloadStringForSigning = JSON.stringify(payloadWithoutSignature)
const hmac = createHmac('sha256', WEBHOOK_SECRET)
hmac.update(payloadStringForSigning)
const signature = `sha256=${hmac.digest('hex')}`

// Step 3: Add signature to payload
const finalPayload = {
  ...payloadWithoutSignature,
  signature: signature
}

const finalPayloadString = JSON.stringify(finalPayload)

console.log('✓ Payload generated with signature')
console.log('')

// Prepare the full details
const details = `═══════════════════════════════════════════════════════════════
CENTR WEBHOOK - COMPLETE PAYLOAD CAPTURE
═══════════════════════════════════════════════════════════════

Task ID: ${TASK_ID}
Title: ${task.title}
Generated: ${new Date().toISOString()}

───────────────────────────────────────────────────────────────
WEBHOOK URL:
───────────────────────────────────────────────────────────────
POST https://uat.centr.com/webhooks/v1/loud-articles?code=sk_0wjgbMYDFkXscTeSze4rPvk96nliBIy1PnykQruamuQ=

───────────────────────────────────────────────────────────────
HEADERS SENT:
───────────────────────────────────────────────────────────────
Content-Type: application/json
X-Webhook-Signature: ${signature}
X-Webhook-Event: content_complete
X-Webhook-ID: 90a96442-89cb-4a2c-bcef-1bb288e48d24
X-Webhook-GUID: ${task.task_id}
X-Webhook-Timestamp: ${timestamp}

───────────────────────────────────────────────────────────────
SIGNATURE GENERATION PROCESS:
───────────────────────────────────────────────────────────────
Step 1: Create payload WITHOUT signature field
Step 2: Compute HMAC-SHA256 using secret: ${WEBHOOK_SECRET}
Step 3: Format as: sha256=<hex>
Step 4: Add signature to payload at top level
Step 5: Send payload WITH signature in BOTH header AND body

───────────────────────────────────────────────────────────────
PAYLOAD STATISTICS:
───────────────────────────────────────────────────────────────
Total Size: ${(finalPayloadString.length / 1024).toFixed(2)} KB
Content Size: ${task.content ? (task.content.length / 1024).toFixed(2) : '0'} KB
Characters: ${finalPayloadString.length.toLocaleString()}

───────────────────────────────────────────────────────────────
SIGNATURE:
───────────────────────────────────────────────────────────────
${signature}

═══════════════════════════════════════════════════════════════
COMPLETE PAYLOAD JSON (EXACTLY AS SENT):
═══════════════════════════════════════════════════════════════
(See: webhook-payload-full.json)

PAYLOAD STRUCTURE:
{
  "guid": "${task.task_id}",
  "event": "content_complete",
  "timestamp": "${timestamp}",
  "signature": "${signature}",  ← SIGNATURE AT TOP LEVEL
  "data": {
    "status": "${task.status}",
    "title": "${task.title}",
    "slug": "${generateSlug(task.title)}",
    "client_domain": "${task.client_domain}",
    "html_link": ${task.html_link ? '"' + task.html_link + '"' : 'null'},
    "google_doc_link": ${task.google_doc_link ? '"' + task.google_doc_link + '"' : 'null'},
    "content": "<!DOCTYPE html>...[${task.content ? (task.content.length / 1024).toFixed(0) : '0'} KB of HTML]...",
    "seo_keyword": "${task.seo_keyword || ''}",
    "meta_description": "${task.meta_description || ''}",
    "live_post_url": "${task.live_post_url || ''}"
  }
}

═══════════════════════════════════════════════════════════════
FILES GENERATED:
═══════════════════════════════════════════════════════════════
1. webhook-payload-full.json     - Complete payload (${(finalPayloadString.length / 1024).toFixed(2)} KB)
2. webhook-payload-readable.json - Formatted for readability
3. webhook-details-for-erik.txt  - This file with all details
4. webhook-html-only.html        - Just the HTML content
5. webhook-signature-test.txt    - Test command for Erik

═══════════════════════════════════════════════════════════════
TO SEND TO ERIK:
═══════════════════════════════════════════════════════════════
Attach these 5 files to your email. They contain:
- The exact payload bytes we send
- All headers we include
- The HTML content
- Instructions to verify the signature

═══════════════════════════════════════════════════════════════
END OF CAPTURE
═══════════════════════════════════════════════════════════════
`

// Save all files
writeFileSync('webhook-payload-full.json', finalPayloadString)
writeFileSync('webhook-payload-readable.json', JSON.stringify(finalPayload, null, 2))
writeFileSync('webhook-details-for-erik.txt', details)
writeFileSync('webhook-html-only.html', task.content || task.post_html || '')

// Create a test command for Erik
const testCommand = `# Test Command for Erik to Verify Signature
# ============================================

# 1. Compute signature from the payload file
cat webhook-payload-full.json | openssl dgst -sha256 -hmac "${WEBHOOK_SECRET}"

# Expected output:
# ${signature.replace('sha256=', '')}

# 2. Verify it matches the signature in the payload
grep "signature" webhook-payload-full.json

# Should show:
# "signature":"${signature}"

# ============================================
# The signature is calculated from the payload
# BEFORE the signature field is added.
# ============================================
`

writeFileSync('webhook-signature-test.txt', testCommand)

// Print summary
console.log('')
console.log('✅ CAPTURE COMPLETE!')
console.log('')
console.log('📁 Files created:')
console.log(`   1. webhook-payload-full.json (${(finalPayloadString.length / 1024).toFixed(2)} KB)`)
console.log('   2. webhook-payload-readable.json')
console.log('   3. webhook-details-for-erik.txt')
console.log(`   4. webhook-html-only.html (${task.content ? (task.content.length / 1024).toFixed(2) : '0'} KB)`)
console.log('   5. webhook-signature-test.txt')
console.log('')
console.log('📧 Send these 5 files to Erik')
console.log('')
console.log('Key Details:')
console.log(`   Task: ${task.title}`)
console.log(`   Signature: ${signature}`)
console.log(`   Payload Size: ${(finalPayloadString.length / 1024).toFixed(2)} KB`)
console.log('')

