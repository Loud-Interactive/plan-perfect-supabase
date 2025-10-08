const SYNOPSIS_ENDPOINT = Deno.env.get('CLIENT_SYNOPSIS_ENDPOINT') ?? 'https://pp-api.replit.app/pairs'

export async function fetchClientSynopsis(domain: string): Promise<Record<string, unknown>> {
  if (!domain) return {}
  const resp = await fetch(`${SYNOPSIS_ENDPOINT}/${domain}`)
  if (!resp.ok) {
    console.warn('Failed to fetch client synopsis', resp.status)
    return {}
  }
  try {
    return await resp.json()
  } catch (err) {
    console.error('Synopsis JSON parse error', err)
    return {}
  }
}
