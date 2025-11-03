#!/usr/bin/env node

import { createHmac } from 'crypto'
import { readFileSync } from 'fs'

const WEBHOOK_URL = 'https://uat.centr.com/webhooks/v1/loud-articles?code=sk_0wjgbMYDFkXscTeSze4rPvk96nliBIy1PnykQruamuQ='
const WEBHOOK_SECRET = 'MDAdVT7rXYThlWUz6h/kwbKYsotGcFOfyPqBI30ojvUA1qHb6dF1dx5oddaSnib1'

// Read the full payload we generated earlier
let payloadWithoutSig
try {
  const payloadContent = readFileSync('webhook-payload-full.json', 'utf-8')
  const fullPayload = JSON.parse(payloadContent)
  
  // Remove the signature to regenerate it
  const { signature, ...rest } = fullPayload
  payloadWithoutSig = rest
} catch (error) {
  console.error('❌ Could not read webhook-payload-full.json')
  console.error('   Run: node capture-full-webhook-payload.mjs first')
  process.exit(1)
}

console.log('📤 Testing FULL REAL PAYLOAD directly to Centr...')
console.log(`   Payload size: ${JSON.stringify(payloadWithoutSig).length} bytes`)
console.log(`   Task: ${payloadWithoutSig.guid}`)
console.log('')

// Generate signature from payload WITHOUT signature
const payloadStringForSigning = JSON.stringify(payloadWithoutSig)
const hmac = createHmac('sha256', WEBHOOK_SECRET)
hmac.update(payloadStringForSigning)
const signature = `sha256=${hmac.digest('hex')}`

// Add signature to payload
const payloadWithSig = {
  ...payloadWithoutSig,
  signature: signature
}

const finalPayload = JSON.stringify(payloadWithSig)

console.log(`📊 Final payload size: ${finalPayload.length} bytes (${(finalPayload.length / 1024).toFixed(2)} KB)`)
console.log(`🔐 Signature: ${signature}`)
console.log('')
console.log('Sending to Centr UAT...')
console.log('')

try {
  const response = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Signature': signature,
      'X-Webhook-Event': 'content_complete',
      'X-Webhook-ID': '90a96442-89cb-4a2c-bcef-1bb288e48d24',
      'X-Webhook-GUID': payloadWithoutSig.guid,
      'X-Webhook-Timestamp': payloadWithoutSig.timestamp
    },
    body: finalPayload
  })

  console.log(`📊 Response: ${response.status} ${response.statusText}`)
  console.log('')
  
  const contentType = response.headers.get('content-type')
  let body
  
  if (contentType && contentType.includes('application/json')) {
    body = await response.json()
    console.log('📄 Response Body:')
    console.log(JSON.stringify(body, null, 2))
  } else {
    body = await response.text()
    console.log('📄 Response Body (Text):')
    console.log(body)
  }
  
  console.log('')
  if (response.ok) {
    console.log('✅ SUCCESS! Full payload accepted by Centr!')
  } else {
    console.log('❌ FAILED! Same 403 error with full payload')
    console.log('')
    console.log('This means the issue is likely:')
    console.log('  1. Payload size (36 KB might be too large)')
    console.log('  2. Something in the HTML content Centr doesn\'t like')
    console.log('  3. Signature calculation on large payloads')
  }
  
} catch (error) {
  console.error('❌ Error:', error.message)
}

