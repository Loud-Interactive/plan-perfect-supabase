#!/usr/bin/env node

import { createHmac } from 'crypto'
import { writeFileSync } from 'fs'

const WEBHOOK_SECRET = 'MDAdVT7rXYThlWUz6h/kwbKYsotGcFOfyPqBI30ojvUA1qHb6dF1dx5oddaSnib1'
const TASK_ID = 'ae1c8678-4178-4fe9-888a-2674af83a959'
const STORAGE_URL = `https://jsypctdhynsdqrfifvdh.supabase.co/storage/v1/object/public/blogs/centr.com/${TASK_ID}.html`

// Build payload WITHOUT signature (exactly as the Edge Function does)
const timestamp = new Date().toISOString()
const payloadWithoutSignature = {
  guid: TASK_ID,
  event: 'content_complete',
  timestamp: timestamp,
  data: {
    status: 'Completed',
    title: 'chris hemsworth gym workout',
    slug: 'chris-hemsworth-gym-workout',
    client_domain: 'centr.com',
    html_link: STORAGE_URL,  // ← STORAGE URL INSTEAD OF HTML
    google_doc_link: 'https://docs.google.com/document/d/1uVwbDZIpazAWHvPZx01bPN0qDKCE7RYs71k-ld_LbhU/edit',
    // content field is OMITTED when html_link is present
    seo_keyword: 'chris hemsworth gym workout',
    meta_description: 'Master Chris Hemsworth\'s workout foundation with dynamic warm-ups, core circuits, mobility drills, and compound power moves for serious strength gains.',
    live_post_url: 'https://centr.com/chris-hemsworth-gym-workout'
  }
}

// Generate signature
const payloadStringForSigning = JSON.stringify(payloadWithoutSignature)
const hmac = createHmac('sha256', WEBHOOK_SECRET)
hmac.update(payloadStringForSigning)
const signature = `sha256=${hmac.digest('hex')}`

// Add signature to payload
const finalPayload = {
  ...payloadWithoutSignature,
  signature: signature
}

const finalPayloadString = JSON.stringify(finalPayload)

console.log('═══════════════════════════════════════════════════════════════')
console.log('CENTR WEBHOOK - COMPLETE PAYLOAD WITH STORAGE URL')
console.log('═══════════════════════════════════════════════════════════════')
console.log('')
console.log('Task ID:', TASK_ID)
console.log('Timestamp:', timestamp)
console.log('Signature:', signature)
console.log('')
console.log('Payload Size:', finalPayloadString.length, 'bytes')
console.log('Previous Size: 37,359 bytes (with HTML)')
console.log('Reduction:', ((1 - finalPayloadString.length / 37359) * 100).toFixed(1) + '%')
console.log('')
console.log('═══════════════════════════════════════════════════════════════')
console.log('WEBHOOK URL:')
console.log('═══════════════════════════════════════════════════════════════')
console.log('POST https://uat.centr.com/webhooks/v1/loud-articles?code=sk_0wjgbMYDFkXscTeSze4rPvk96nliBIy1PnykQruamuQ=')
console.log('')
console.log('═══════════════════════════════════════════════════════════════')
console.log('HEADERS:')
console.log('═══════════════════════════════════════════════════════════════')
console.log('Content-Type: application/json')
console.log(`X-Webhook-Signature: ${signature}`)
console.log('X-Webhook-Event: content_complete')
console.log('X-Webhook-ID: 90a96442-89cb-4a2c-bcef-1bb288e48d24')
console.log(`X-Webhook-GUID: ${TASK_ID}`)
console.log(`X-Webhook-Timestamp: ${timestamp}`)
console.log('')
console.log('═══════════════════════════════════════════════════════════════')
console.log('COMPLETE JSON PAYLOAD (BODY):')
console.log('═══════════════════════════════════════════════════════════════')
console.log(JSON.stringify(finalPayload, null, 2))
console.log('')
console.log('═══════════════════════════════════════════════════════════════')
console.log('COMPACT JSON PAYLOAD (AS SENT):')
console.log('═══════════════════════════════════════════════════════════════')
console.log(finalPayloadString)
console.log('')
console.log('═══════════════════════════════════════════════════════════════')
console.log('KEY CHANGES:')
console.log('═══════════════════════════════════════════════════════════════')
console.log('✅ html_link: Storage URL (not inline HTML)')
console.log('✅ content field: OMITTED (fetch from html_link instead)')
console.log('✅ Payload size: Reduced by', ((1 - finalPayloadString.length / 37359) * 100).toFixed(1) + '%')
console.log('✅ Signature: Included in BOTH header and body')
console.log('')
console.log('═══════════════════════════════════════════════════════════════')
console.log('HTML CONTENT LOCATION:')
console.log('═══════════════════════════════════════════════════════════════')
console.log(STORAGE_URL)
console.log('')
console.log('To fetch HTML:')
console.log(`  curl -s "${STORAGE_URL}"`)
console.log('')

// Save files
writeFileSync('centr-payload-with-storage-url.json', JSON.stringify(finalPayload, null, 2))
writeFileSync('centr-payload-compact.json', finalPayloadString)

const details = `CENTR WEBHOOK - STORAGE URL PAYLOAD
═══════════════════════════════════════════════════════════════

WEBHOOK ENDPOINT:
POST https://uat.centr.com/webhooks/v1/loud-articles?code=sk_0wjgbMYDFkXscTeSze4rPvk96nliBIy1PnykQruamuQ=

HEADERS:
Content-Type: application/json
X-Webhook-Signature: ${signature}
X-Webhook-Event: content_complete
X-Webhook-ID: 90a96442-89cb-4a2c-bcef-1bb288e48d24
X-Webhook-GUID: ${TASK_ID}
X-Webhook-Timestamp: ${timestamp}

PAYLOAD SIZE:
- New: ${finalPayloadString.length} bytes (~${(finalPayloadString.length / 1024).toFixed(2)} KB)
- Old: 37,359 bytes (36.48 KB with HTML)
- Reduction: ${((1 - finalPayloadString.length / 37359) * 100).toFixed(1)}%

KEY CHANGE:
Instead of including 35KB of HTML in the "content" field, we now:
- Upload HTML to: /blogs/centr.com/${TASK_ID}.html
- Send URL in: data.html_link
- Omit: data.content field

HTML LOCATION:
${STORAGE_URL}

To fetch the HTML:
curl -s "${STORAGE_URL}"

SIGNATURE DETAILS:
- Algorithm: HMAC-SHA256
- Secret: ${WEBHOOK_SECRET}
- Format: sha256=<hex>
- Location: BOTH X-Webhook-Signature header AND payload.signature field

COMPLETE PAYLOAD:
See: centr-payload-with-storage-url.json
See: centr-payload-compact.json (exactly as sent)
`

writeFileSync('centr-payload-details.txt', details)

console.log('✅ Files saved:')
console.log('   1. centr-payload-with-storage-url.json (formatted)')
console.log('   2. centr-payload-compact.json (compact, as sent)')
console.log('   3. centr-payload-details.txt (full details)')
console.log('')

