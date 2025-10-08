import { encode as base64Encode, decode as base64Decode } from 'https://deno.land/std@0.224.0/encoding/base64.ts'

const SERVICE_ACCOUNT_B64 = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON')
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
const TOKEN_AUDIENCE = 'https://oauth2.googleapis.com/token'

interface ServiceAccount {
  client_email: string
  private_key: string
}

async function getAccessToken(): Promise<string | null> {
  if (!SERVICE_ACCOUNT_B64) {
    console.warn('GOOGLE_SERVICE_ACCOUNT_JSON not set—skipping Drive upload')
    return null
  }

  const serviceAccount = JSON.parse(new TextDecoder().decode(base64Decode(SERVICE_ACCOUNT_B64))) as ServiceAccount
  const now = Math.floor(Date.now() / 1000)
  const header = base64Encode(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })))
  const payload = base64Encode(
    new TextEncoder().encode(
      JSON.stringify({
        iss: serviceAccount.client_email,
        scope: DRIVE_SCOPE,
        aud: TOKEN_AUDIENCE,
        exp: now + 3600,
        iat: now,
      }),
    ),
  )
  const message = `${header}.${payload}`
  const pkcs8 = base64Decode(serviceAccount.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''))
  const keyBuffer = pkcs8.buffer.slice(pkcs8.byteOffset, pkcs8.byteOffset + pkcs8.byteLength)
  const key = await crypto.subtle.importKey(
    'pkcs8',
    keyBuffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signatureArray = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    new TextEncoder().encode(message),
  )
  const jwt = `${message}.${base64Encode(new Uint8Array(signatureArray))}`

  const resp = await fetch(TOKEN_AUDIENCE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  })
  if (!resp.ok) {
    const text = await resp.text()
    console.error('Google token error', resp.status, text)
    return null
  }
  const data = await resp.json()
  return data.access_token as string
}

async function driveRequest(path: string, init: RequestInit & { accessToken: string }) {
  const resp = await fetch(`https://www.googleapis.com/drive/v3/${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${init.accessToken}`,
    },
  })
  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`Drive API error ${resp.status}: ${text}`)
  }
  return resp.json()
}

export async function uploadHtmlToDrive(fileName: string, html: string, parentFolderId?: string) {
  const accessToken = await getAccessToken()
  if (!accessToken) return null

  const metadata = {
    name: fileName,
    mimeType: 'text/html',
    parents: parentFolderId ? [parentFolderId] : undefined,
  }

  const boundary = `boundary${crypto.randomUUID()}`
  const bodyParts = [
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    `--${boundary}\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n${html}\r\n`,
    `--${boundary}--`,
  ]

  const resp = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: bodyParts.join(''),
  })

  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`Drive upload failed ${resp.status}: ${text}`)
  }
  const file = await resp.json()
  await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}/permissions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ role: 'reader', type: 'anyone' }),
  })

  return `https://drive.google.com/file/d/${file.id}/view?usp=sharing`
}
