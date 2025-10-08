import { PROMPT_MAP } from '../../../resources/prompts/index.ts'
import { supabaseAdmin } from './client.ts'

type PromptContext = {
  synopsis?: Record<string, unknown> | null
  domain?: string | null
}

function getFromSynopsis(name: string, synopsis?: Record<string, unknown> | null): string | undefined {
  if (!synopsis) return undefined
  const direct = synopsis[name]
  if (typeof direct === 'string' && direct.trim()) return direct
  // some clients store prompts under uppercase/lowercase variations
  const lowerKey = Object.keys(synopsis).find((key) => key.toLowerCase() === name.toLowerCase())
  if (lowerKey) {
    const value = synopsis[lowerKey]
    if (typeof value === 'string' && value.trim()) return value
  }
  return undefined
}

async function getFromPairsTable(name: string, domain?: string | null): Promise<string | undefined> {
  if (!domain) return undefined
  try {
    const { data, error } = await supabaseAdmin
      .from('pairs')
      .select('value')
      .eq('domain', domain)
      .eq('key', name)
      .maybeSingle()

    if (error) {
      console.warn('pairs lookup error', error)
      return undefined
    }
    const value = data?.value
    if (typeof value === 'string' && value.trim()) return value
  } catch (err) {
    console.warn('pairs lookup exception', err)
  }
  return undefined
}

export async function resolvePrompt(name: string, context: PromptContext = {}): Promise<string> {
  const synopsisValue = getFromSynopsis(name, context.synopsis)
  if (synopsisValue) return synopsisValue

  const pairsValue = await getFromPairsTable(name, context.domain)
  if (pairsValue) return pairsValue

  const fallback = PROMPT_MAP[name]
  if (typeof fallback === 'string' && fallback.trim()) {
    return fallback
  }
  throw new Error(`Prompt "${name}" is not defined. Populate pairs table or resources/prompts/index.ts.`)
}
