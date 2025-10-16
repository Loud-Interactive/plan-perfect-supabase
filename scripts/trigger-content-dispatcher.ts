#!/usr/bin/env -S deno run --allow-net --allow-env

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? 'https://jsypctdhynsdqrfifvdh.supabase.co'
const DISPATCHER_PATH = '/functions/v1/content-queue-dispatcher'
const DISPATCHER_URL = `${SUPABASE_URL.replace(/\/$/, '')}${DISPATCHER_PATH}`
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const API_KEY = Deno.env.get('SUPABASE_ANON_KEY')

async function main() {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  }

  if (SERVICE_ROLE_KEY) {
    headers['Authorization'] = `Bearer ${SERVICE_ROLE_KEY}`
  } else if (API_KEY) {
    headers['Authorization'] = `Bearer ${API_KEY}`
  }

  const body = {
    source: 'manual-trigger',
    at: new Date().toISOString(),
  }

  console.log(`Triggering dispatcher at ${DISPATCHER_URL}`)

  try {
    const response = await fetch(DISPATCHER_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      console.error(`Dispatcher returned status ${response.status}`)
      const text = await response.text()
      console.error(text)
      Deno.exit(1)
    }

    const payload = await response.json()
    console.log('Dispatcher response:', JSON.stringify(payload, null, 2))
  } catch (error) {
    console.error('Failed to trigger dispatcher:', error)
    Deno.exit(1)
  }
}

if (import.meta.main) {
  await main()
}
