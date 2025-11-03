#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js'
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

const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

console.log('🧪 Testing Supabase Storage Upload')
console.log('═══════════════════════════════════')
console.log('')

const testGuid = 'test-' + Date.now()
const testHtml = '<html><body><h1>Test HTML Upload</h1><p>This is a test to verify storage upload works.</p></body></html>'

console.log(`Test GUID: ${testGuid}`)
console.log(`HTML Size: ${testHtml.length} bytes`)
console.log('')

try {
  console.log('Uploading to: blogs/centr.com/${testGuid}.html')
  
  const { data, error } = await supabase
    .storage
    .from('blogs')
    .upload(`centr.com/${testGuid}.html`, testHtml, {
      contentType: 'text/html',
      upsert: true
    })

  if (error) {
    console.error('❌ Upload failed:', error)
  } else {
    console.log('✅ Upload successful!')
    console.log('   Data:', data)
    
    // Get public URL
    const { data: { publicUrl } } = supabase
      .storage
      .from('blogs')
      .getPublicUrl(`centr.com/${testGuid}.html`)
    
    console.log(`   Public URL: ${publicUrl}`)
    
    // Verify we can fetch it
    const fetchResponse = await fetch(publicUrl)
    if (fetchResponse.ok) {
      const fetchedHtml = await fetchResponse.text()
      console.log(`   ✅ Verified! Fetched ${fetchedHtml.length} bytes`)
    } else {
      console.log(`   ❌ Fetch failed: ${fetchResponse.status}`)
    }
  }
} catch (error) {
  console.error('❌ Error:', error.message)
}

