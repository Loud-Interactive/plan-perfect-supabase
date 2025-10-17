import { assertEquals, assert } from 'https://deno.land/std@0.177.0/testing/asserts.ts'
import type { QueueMessage } from './queue.ts'
import type { StageHandler } from './stage-runner.ts'
import { processStageMessage } from './stage-runner.ts'
import type { StageInfo, StageFailureInfo } from './stages.ts'
import { FatalStageError } from './errors.ts'

type Payload = Record<string, unknown>

function createMessage(stage = 'research'): QueueMessage<Payload> {
  return {
    msg_id: 42,
    message: {
      job_id: 'job-123',
      stage,
      payload: {},
      priority: 0,
      enqueued_at: new Date().toISOString(),
    },
  }
}

function createStageInfo(): StageInfo {
  return {
    attempt_count: 1,
    max_attempts: 3,
    retry_delay_seconds: 30,
    priority: 5,
    status: 'processing',
  }
}

function createFailureInfo(overrides: Partial<StageFailureInfo> = {}): StageFailureInfo {
  return {
    attemptCount: 1,
    maxAttempts: 3,
    retryDelaySeconds: 30,
    priority: 5,
    stageStatus: 'error',
    willRetry: true,
    nextRetryAt: null,
    finishedAt: new Date().toISOString(),
    ...overrides,
  }
}

Deno.test('processStageMessage completes stage on success', async () => {
  const stageInfo = createStageInfo()
  let completeCalled = 0
  let ackCalled = 0

  const handler: StageHandler<Payload> = async () => ({ complete: true })

  const result = await processStageMessage({
    queue: 'content',
    expectedStage: 'research',
    message: createMessage(),
    visibilitySeconds: 600,
    handler,
    services: {
      startStage: async () => stageInfo,
      completeStage: async () => {
        completeCalled += 1
      },
      failStage: async () => createFailureInfo(),
      ackMessage: async () => {
        ackCalled += 1
      },
      enqueueJob: async () => 0,
      delayedRequeueJob: async () => 0,
      moveToDeadLetter: async () => 0,
      now: () => new Date('2024-01-01T00:00:00Z'),
    },
  })

  assertEquals(result.status, 'completed')
  assertEquals(result.jobId, 'job-123')
  assertEquals(completeCalled, 1)
  assertEquals(ackCalled, 1)
})

Deno.test('processStageMessage leaves stage pending when handler continues', async () => {
  const stageInfo = createStageInfo()
  let completeCalled = 0
  let ackCalled = 0

  const handler: StageHandler<Payload> = async () => ({ complete: false })

  const result = await processStageMessage({
    queue: 'content',
    expectedStage: 'draft',
    message: createMessage('draft'),
    visibilitySeconds: 600,
    handler,
    services: {
      startStage: async () => stageInfo,
      completeStage: async () => {
        completeCalled += 1
      },
      failStage: async () => createFailureInfo(),
      ackMessage: async () => {
        ackCalled += 1
      },
      enqueueJob: async () => 0,
      delayedRequeueJob: async () => 0,
      moveToDeadLetter: async () => 0,
      now: () => new Date('2024-01-01T00:00:00Z'),
    },
  })

  assertEquals(result.status, 'pending')
  assertEquals(completeCalled, 0)
  assertEquals(ackCalled, 1)
})

Deno.test('processStageMessage dead-letters on fatal errors', async () => {
  const stageInfo = createStageInfo()
  let failCalled = 0
  let moveCalled = 0

  const handler: StageHandler<Payload> = async () => {
    throw new FatalStageError('fatal issue')
  }

  const result = await processStageMessage({
    queue: 'content',
    expectedStage: 'research',
    message: createMessage(),
    visibilitySeconds: 600,
    handler,
    services: {
      startStage: async () => stageInfo,
      completeStage: async () => {},
      failStage: async () => {
        failCalled += 1
        return createFailureInfo({ willRetry: true })
      },
      ackMessage: async () => {},
      enqueueJob: async () => 0,
      delayedRequeueJob: async () => 0,
      moveToDeadLetter: async () => {
        moveCalled += 1
        return 0
      },
      now: () => new Date('2024-01-01T00:00:00Z'),
    },
  })

  assertEquals(result.status, 'dead_lettered')
  assertEquals(failCalled, 1)
  assertEquals(moveCalled, 1)
})

Deno.test('processStageMessage requeues retryable errors', async () => {
  const stageInfo = createStageInfo()
  let requeueCalled = 0

  const handler: StageHandler<Payload> = async () => {
    throw new Error('temporary network issue')
  }

  const result = await processStageMessage({
    queue: 'content',
    expectedStage: 'research',
    message: createMessage(),
    visibilitySeconds: 600,
    handler,
    services: {
      startStage: async () => stageInfo,
      completeStage: async () => {},
      failStage: async () => createFailureInfo({ willRetry: true }),
      ackMessage: async () => {},
      enqueueJob: async () => 0,
      delayedRequeueJob: async () => {
        requeueCalled += 1
        return 0
      },
      moveToDeadLetter: async () => 0,
      now: () => new Date('2024-01-01T00:00:00Z'),
    },
  })

  assertEquals(result.status, 'requeued')
  assertEquals(requeueCalled, 1)
})

Deno.test('processStageMessage forwards unexpected stages', async () => {
  let forwarded = false
  let ackCalled = false

  const result = await processStageMessage({
    queue: 'content',
    expectedStage: 'research',
    message: createMessage('qa'),
    visibilitySeconds: 600,
    handler: async () => ({ complete: true }),
    services: {
      startStage: async () => createStageInfo(),
      completeStage: async () => {},
      failStage: async () => createFailureInfo(),
      ackMessage: async () => {
        ackCalled = true
      },
      enqueueJob: async () => {
        forwarded = true
        return 0
      },
      delayedRequeueJob: async () => 0,
      moveToDeadLetter: async () => 0,
      now: () => new Date('2024-01-01T00:00:00Z'),
    },
  })

  assertEquals(result.status, 'forwarded')
  assert(forwarded)
  assert(ackCalled)
})
