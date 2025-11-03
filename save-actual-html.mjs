#!/usr/bin/env node

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

console.log('📥 Fetching task HTML from Supabase...')

// Fetch the actual task
const response = await fetch(`${SUPABASE_URL}/rest/v1/tasks?task_id=eq.ae1c8678-4178-4fe9-888a-2674af83a959&select=task_id,title,content,post_html`, {
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
console.log(`  Task ID: ${task.task_id}`)

// Get the HTML content (try both fields)
const htmlContent = task.content || task.post_html

if (!htmlContent) {
  console.error('❌ No HTML content found in task')
  process.exit(1)
}

console.log(`  HTML size: ${(htmlContent.length / 1024).toFixed(2)} KB`)
console.log('')

// Save the HTML
writeFileSync('actual-webhook-html.html', htmlContent)
console.log('✅ Saved complete HTML to: actual-webhook-html.html')
console.log('')
console.log('This is the exact HTML being sent in the webhook payload.')
console.log('You can open this file in a browser to see how it renders.')

