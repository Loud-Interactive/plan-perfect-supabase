import { RetryError, isRetryableError as isGenericRetryableError } from './retry-strategies.ts'

export interface StageErrorMetadata {
  [key: string]: unknown
}

export class StageError extends Error {
  metadata?: StageErrorMetadata

  constructor(message: string, options: { cause?: unknown; metadata?: StageErrorMetadata } = {}) {
    super(message)
    this.name = new.target.name
    if (options.cause !== undefined) {
      // deno-lint-ignore no-explicit-any
      ;(this as any).cause = options.cause
    }
    if (options.metadata) {
      this.metadata = options.metadata
    }
  }
}

export class FatalStageError extends StageError {}

export class RetryableStageError extends StageError {}

export interface StageErrorClassification {
  fatal: boolean
  retryable: boolean
  reason: string
  error: Error
}

export function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error
  }
  if (typeof error === 'string') {
    return new Error(error)
  }
  try {
    return new Error(JSON.stringify(error))
  } catch {
    return new Error(String(error))
  }
}

function mergeMetadata(error: Error): StageErrorMetadata | undefined {
  if (error instanceof StageError) {
    return error.metadata
  }
  // deno-lint-ignore no-explicit-any
  const meta = (error as any).metadata
  if (meta && typeof meta === 'object') {
    return meta as StageErrorMetadata
  }
  return undefined
}

export function classifyStageError(error: unknown): StageErrorClassification {
  const err = toError(error)

  if (err instanceof FatalStageError) {
    return {
      fatal: true,
      retryable: false,
      reason: err.message || 'fatal_error',
      error: err,
    }
  }

  if (err instanceof RetryableStageError) {
    return {
      fatal: false,
      retryable: true,
      reason: err.message || 'retryable_error',
      error: err,
    }
  }

  if (err instanceof RetryError) {
    const innerClassification = classifyStageError(err.lastError)
    return {
      ...innerClassification,
      error: err,
    }
  }

  const retryable = isGenericRetryableError(err)

  return {
    fatal: !retryable,
    retryable,
    reason: retryable ? 'transient_error' : 'non_retryable_error',
    error: err,
  }
}

function getCauseDetails(error: Error): unknown {
  // deno-lint-ignore no-explicit-any
  const cause = (error as any).cause
  if (!cause) {
    return undefined
  }
  if (cause instanceof Error) {
    return serializeStageError(cause)
  }
  return cause
}

export function serializeStageError(error: unknown): Record<string, unknown> {
  const err = toError(error)
  const metadata = mergeMetadata(err)
  const serialized: Record<string, unknown> = {
    name: err.name,
    message: err.message,
  }

  // deno-lint-ignore no-explicit-any
  const code = (err as any).code
  if (code !== undefined) {
    serialized.code = code
  }

  // deno-lint-ignore no-explicit-any
  const status = (err as any).status
  if (status !== undefined) {
    serialized.status = status
  }

  if (metadata) {
    serialized.metadata = metadata
  }

  const cause = getCauseDetails(err)
  if (cause !== undefined) {
    serialized.cause = cause
  }

  if (err.stack) {
    serialized.stack = err.stack
  }

  return serialized
}

export function isFatalStageError(error: unknown): boolean {
  return classifyStageError(error).fatal
}

export function isRetryableStageError(error: unknown): boolean {
  return classifyStageError(error).retryable
}
