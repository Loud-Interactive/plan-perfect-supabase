import { assert, assertEquals } from 'https://deno.land/std@0.177.0/testing/asserts.ts'
import {
  FatalStageError,
  RetryableStageError,
  classifyStageError,
  serializeStageError,
} from './errors.ts'
import { RetryError } from './retry-strategies.ts'

Deno.test('classifyStageError identifies fatal errors', () => {
  const classification = classifyStageError(new FatalStageError('fatal example'))
  assertEquals(classification.fatal, true)
  assertEquals(classification.retryable, false)
  assert(classification.reason.includes('fatal'))
})

Deno.test('classifyStageError identifies retryable errors', () => {
  const classification = classifyStageError(new RetryableStageError('retry me'))
  assertEquals(classification.fatal, false)
  assertEquals(classification.retryable, true)
})

Deno.test('classifyStageError unwraps RetryError', () => {
  const inner = new Error('timeout occurred')
  const retryError = new RetryError('operation failed', 3, inner, [inner])
  const classification = classifyStageError(retryError)
  assertEquals(classification.retryable, true)
  assertEquals(classification.fatal, false)
})

Deno.test('classifyStageError flags non retryable errors', () => {
  const classification = classifyStageError(new Error('validation failed'))
  assertEquals(classification.retryable, false)
  assertEquals(classification.fatal, true)
})

Deno.test('serializeStageError captures metadata and cause', () => {
  const error = new FatalStageError('fatal with cause', {
    metadata: { foo: 'bar' },
    cause: new Error('root cause'),
  })
  const serialized = serializeStageError(error)
  assertEquals(serialized.name, 'FatalStageError')
  assertEquals(serialized.message, 'fatal with cause')
  assertEquals((serialized.metadata as Record<string, unknown>).foo, 'bar')
  assert(serialized.cause)
})
