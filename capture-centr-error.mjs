#!/usr/bin/env node

import { createHmac } from 'crypto'
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

const WEBHOOK_URL = 'https://uat.centr.com/webhooks/v1/loud-articles?code=sk_0wjgbMYDFkXscTeSze4rPvk96nliBIy1PnykQruamuQ='
const WEBHOOK_SECRET = 'MDAdVT7rXYThlWUz6h/kwbKYsotGcFOfyPqBI30ojvUA1qHb6dF1dx5oddaSnib1'

// Create a small test payload
const payloadWithoutSig = {
  "guid": "test-error-capture-" + Date.now(),
  "event": "content_complete",
  "timestamp": new Date().toISOString(),
  "data": {
    "status": "completed",
    "title": "Error Capture Test",
    "slug": "error-capture-test",
    "client_domain": "centr.com",
    "html_link": "https://example.com/test.html",
    "google_doc_link": "https://docs.google.com/test",
    "content": "<p>Small test to capture error</p>",
    "seo_keyword": "test",
    "meta_description": "Test",
    "live_post_url": "https://shop.centr.com/blog/test"
  }
}

// Generate signature
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

console.log('📤 Sending test webhook to Centr UAT endpoint...')
console.log(`   URL: ${WEBHOOK_URL}`)
console.log(`   Signature: ${signature}`)
console.log('')

try {
  const response = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Signature': signature,
      'X-Webhook-Event': 'content_complete',
      'X-Webhook-ID': 'test-webhook-id',
      'X-Webhook-GUID': payloadWithoutSig.guid,
      'X-Webhook-Timestamp': payloadWithoutSig.timestamp
    },
    body: finalPayload
  })

  console.log('📊 Response Status:', response.status, response.statusText)
  console.log('')
  console.log('📋 Response Headers:')
  for (const [key, value] of response.headers.entries()) {
    console.log(`   ${key}: ${value}`)
  }
  console.log('')
  
  // Try to read the response body
  const contentType = response.headers.get('content-type')
  let body
  
  if (contentType && contentType.includes('application/json')) {
    body = await response.json()
    console.log('📄 Response Body (JSON):')
    console.log(JSON.stringify(body, null, 2))
  } else {
    body = await response.text()
    console.log('📄 Response Body (Text):')
    console.log(body)
  }
  
  console.log('')
  console.log('─────────────────────────────────────────────────')
  console.log('FULL ERROR RESPONSE FROM CENTR:')
  console.log('─────────────────────────────────────────────────')
  console.log(`Status: ${response.status} ${response.statusText}`)
  console.log(`Body: ${typeof body === 'object' ? JSON.stringify(body) : body}`)
  
} catch (error) {
  console.error('❌ Error making request:', error.message)
}

