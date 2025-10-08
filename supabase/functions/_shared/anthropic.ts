const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')
const ANTHROPIC_MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-3-5-sonnet-20240620'

if (!ANTHROPIC_API_KEY) {
  console.warn('ANTHROPIC_API_KEY not set—LLM calls will fail')
}

interface AnthropicMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

interface AnthropicOptions {
  model?: string
  maxTokens?: number
  temperature?: number
  thinking?: boolean
}

export async function callAnthropic(messages: AnthropicMessage[], options: AnthropicOptions = {}) {
  if (!ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY missing')
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      ...(options.thinking ? { 'anthropic-beta': 'output-128k-2025-02-19' } : {}),
    },
    body: JSON.stringify({
      model: options.model ?? ANTHROPIC_MODEL,
      max_tokens: options.maxTokens ?? 4096,
      temperature: options.temperature ?? 1,
      thinking: options.thinking ? { type: 'enabled', budget_tokens: 6000 } : undefined,
      messages,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Anthropic error ${response.status}: ${errorText}`)
  }

  const data = await response.json()
  const contentBlocks = data?.content ?? []
  const text = contentBlocks
    .filter((block: { type: string }) => block.type === 'text')
    .map((block: { text: string }) => block.text)
    .join('\n')

  return { text, raw: data }
}
