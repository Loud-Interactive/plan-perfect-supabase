#!/usr/bin/env node

import { createHmac } from 'crypto'

const WEBHOOK_SECRET = 'MDAdVT7rXYThlWUz6h/kwbKYsotGcFOfyPqBI30ojvUA1qHb6dF1dx5oddaSnib1'

// Step 1: Create payload WITHOUT signature
const payloadWithoutSignature = {
  "guid": "test-task-123",
  "event": "content_complete",
  "timestamp": "2025-10-30T18:35:00.000Z",
  "data": {
    "status": "completed",
    "title": "Test Article",
    "slug": "test-article",
    "client_domain": "centr.com",
    "html_link": "https://example.com/test.html",
    "google_doc_link": "https://docs.google.com/test",
    "content": "<p>Test content</p>",
    "seo_keyword": "test",
    "meta_description": "Test description",
    "live_post_url": "https://shop.centr.com/blog/test"
  }
}

// Step 2: Generate signature from payload WITHOUT signature field
const payloadStringForSigning = JSON.stringify(payloadWithoutSignature)
const hmac = createHmac('sha256', WEBHOOK_SECRET)
hmac.update(payloadStringForSigning)
const signature = `sha256=${hmac.digest('hex')}`

console.log('🔐 Signature Generation Process (Per Erik\'s Request)')
console.log('═══════════════════════════════════════════════════')
console.log('')
console.log('Step 1: Create payload WITHOUT signature field')
console.log('Step 2: Generate HMAC-SHA256 signature from that payload')
console.log('Step 3: Add signature to payload at top level')
console.log('Step 4: Send final payload with signature in BOTH header AND body')
console.log('')
console.log('─────────────────────────────────────────────────')
console.log('Payload BEFORE signature (used for signing):')
console.log('─────────────────────────────────────────────────')
console.log(JSON.stringify(payloadWithoutSignature, null, 2))
console.log('')
console.log('─────────────────────────────────────────────────')
console.log('Generated Signature:')
console.log('─────────────────────────────────────────────────')
console.log(signature)
console.log('')

// Step 3: Add signature to payload
const payloadWithSignature = {
  ...payloadWithoutSignature,
  signature: signature
}

console.log('─────────────────────────────────────────────────')
console.log('FINAL Payload sent (with signature at top level):')
console.log('─────────────────────────────────────────────────')
console.log(JSON.stringify(payloadWithSignature, null, 2))
console.log('')
console.log('─────────────────────────────────────────────────')
console.log('Headers sent:')
console.log('─────────────────────────────────────────────────')
console.log('Content-Type: application/json')
console.log(`X-Webhook-Signature: ${signature}`)
console.log('X-Webhook-Event: content_complete')
console.log('X-Webhook-ID: 90a96442-89cb-4a2c-bcef-1bb288e48d24')
console.log(`X-Webhook-GUID: ${payloadWithoutSignature.guid}`)
console.log(`X-Webhook-Timestamp: ${payloadWithoutSignature.timestamp}`)
console.log('')
console.log('✅ RESULT: Signature is now in BOTH locations:')
console.log('   1. X-Webhook-Signature header')
console.log('   2. payload.signature field (top level)')
console.log('')
console.log('Note: Both contain the SAME signature value')

