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

const WEBHOOK_SECRET = 'MDAdVT7rXYThlWUz6h/kwbKYsotGcFOfyPqBI30ojvUA1qHb6dF1dx5oddaSnib1'

// Test payload - exactly as it would be sent
const testPayload = {
  "guid": "test-task-123",
  "event": "content_complete",
  "timestamp": "2025-10-30T18:00:00.000Z",
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

// JSON.stringify with no spacing (compact)
const payloadString = JSON.stringify(testPayload)

console.log('🧪 Testing Centr Webhook Signature Generation')
console.log('══════════════════════════════════════════════')
console.log('')
console.log('Payload string (first 200 chars):')
console.log(payloadString.substring(0, 200) + '...')
console.log('')
console.log('Payload length:', payloadString.length, 'bytes')
console.log('')

// Generate HMAC-SHA256 signature
const hmac = createHmac('sha256', WEBHOOK_SECRET)
hmac.update(payloadString)
const signature = hmac.digest('hex')

console.log('Generated Signature:')
console.log(`sha256=${signature}`)
console.log('')
console.log('Signature length:', signature.length, 'chars (hex)')
console.log('')
console.log('Per Erik\'s spec:')
console.log('✓ Algorithm: HMAC-SHA256')
console.log('✓ Format: sha256=<hex>')
console.log('✓ Input: Full JSON body (compact)')
console.log('✓ Header: X-Webhook-Signature')
console.log('')
console.log('If Centr still rejects this signature, contact them with:')
console.log('  1. This exact payload string')
console.log('  2. This exact signature')
console.log('  3. Ask them to verify on their end')

