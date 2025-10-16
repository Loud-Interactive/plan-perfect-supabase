import { retryWithStrategy, type RetryOptions } from './retry-strategies.ts'
import {
  ackMessage,
  delayedRequeueJob,
  enqueueJob,
  moveToDeadLetter,
  type EnqueueOptions,
  type QueueMessage,
} from './queue.ts'
import {
  completeStage,
  failStage,
  startStage,
  type StageCompletionContext,
  type StageContext,
  type StageFailureInfo,
  type StageInfo,
} from './stages.ts'
import {
  classifyStageError,
  serializeStageError,
  type StageErrorClassification,
} from './errors.ts'

export interface StageHandlerContext<TPayload extends Record<string, unknown>> {
  jobId: string
  payload: TPayload
  stage: string
  stageInfo: StageInfo
  queue: string
  messageId: number
  visibilitySeconds: number
  message: QueueMessage<TPayload>['message']
}

export interface StageHandlerResult {
  complete: boolean
}

export type StageHandler<TPayload extends Record<string, unknown>> = (
  context: StageHandlerContext<TPayload>
) => Promise<StageHandlerResult | void>

type QueuePayload = Record<string, unknown>

export interface StageRunnerServices {
  startStage: (jobId: string, stage: string, context?: StageContext) => Promise<StageInfo>
  completeStage: (jobId: string, stage: string, context?: StageCompletionContext) => Promise<void>
  failStage: (
    jobId: string,
    stage: string,
    error: unknown,
    context?: StageCompletionContext
  ) => Promise<StageFailureInfo>
  ackMessage: (queue: string, msgId: number) => Promise<void>
  enqueueJob: (
    queue: string,
    jobId: string,
    stage: string,
    payload?: QueuePayload,
    options?: number | EnqueueOptions
  ) => Promise<number>
  delayedRequeueJob: (
    queue: string,
    msgId: number,
    jobId: string,
    stage: string,
    payload?: QueuePayload,
    options?: {
      baseDelaySeconds?: number
      priorityOverride?: number
      visibilitySeconds?: number
    }
  ) => Promise<number>
  moveToDeadLetter: (
    queue: string,
    msgId: number,
    jobId: string,
    stage: string,
    message: QueuePayload,
    failureReason: string,
    errorDetails?: QueuePayload,
    attemptCount?: number
  ) => Promise<number>
  now: () => Date
}

const defaultServices: StageRunnerServices = {
  startStage,
  completeStage,
  failStage,
  ackMessage,
  enqueueJob,
  delayedRequeueJob,
  moveToDeadLetter,
  now: () => new Date(),
}

export type StageProcessingStatus =
  | 'invalid'
  | 'forwarded'
  | 'completed'
  | 'pending'
  | 'requeued'
  | 'dead_lettered'

export interface StageProcessingOutcome {
  status: StageProcessingStatus
  jobId?: string
  stage: string
  attempt?: number
  reason?: string
}

export interface StageRunnerOptions<TPayload extends Record<string, unknown>> {
  queue: string
  expectedStage: string
  message: QueueMessage<TPayload>
  visibilitySeconds: number
  handler: StageHandler<TPayload>
  handlerRetryOptions?: Partial<RetryOptions>
  services?: StageRunnerServices
}

function safeEnvGet(key: string): string | undefined {
  try {
    return Deno.env.get(key)
  } catch {
    return undefined
  }
}

function resolveHandlerRetryOptions(stageInfo: StageInfo, overrides?: Partial<RetryOptions>): Partial<RetryOptions> {
  const envMaxRetries = Number.parseInt(safeEnvGet('CONTENT_STAGE_HANDLER_MAX_RETRIES') ?? '1', 10)
  const maxRetries = overrides?.maxRetries ?? (Number.isFinite(envMaxRetries) && envMaxRetries > 0 ? envMaxRetries : 1)
  const baseDelay = overrides?.baseDelay ?? Math.max(250, stageInfo.retry_delay_seconds * 1000)
  const maxDelay = overrides?.maxDelay ?? Math.max(baseDelay, stageInfo.retry_delay_seconds * 1000 * 32)
  const factor = overrides?.factor ?? 2
  const jitter = overrides?.jitter ?? true

  return {
    strategy: 'exponential',
    maxRetries,
    baseDelay,
    maxDelay,
    factor,
    jitter,
    onRetry: overrides?.onRetry,
    shouldRetry: overrides?.shouldRetry,
    abortSignal: overrides?.abortSignal,
  }
}

function ensureHandlerResult(result?: StageHandlerResult | void): StageHandlerResult {
  if (!result) {
    return { complete: true }
  }
  return result
}

function buildStageContext(
  queue: string,
  messageId: number,
  services: StageRunnerServices,
  message: QueueMessage<Record<string, unknown>>['message']
): StageContext {
  return {
    queue,
    messageId,
    enqueuedAt: message?.enqueued_at,
    availableAt: message?.available_at,
    dequeuedAt: services.now().toISOString(),
  }
}

async function recordFailure<TPayload extends Record<string, unknown>>(
  services: StageRunnerServices,
  options: StageRunnerOptions<TPayload>,
  error: unknown,
  classification: StageErrorClassification,
  stageInfo: StageInfo
): Promise<{ info: StageFailureInfo; status: StageProcessingOutcome }> {
  const { queue, expectedStage, message, visibilitySeconds } = options
  const { msg_id, message: body } = message
  const jobId = body?.job_id ?? ''
  const payload = (body?.payload ?? {}) as QueuePayload

  let failureInfo: StageFailureInfo
  try {
    failureInfo = await services.failStage(jobId, expectedStage, error, {
      queue,
      messageId: msg_id,
    })
  } catch (failRecordError) {
    console.error('stage-runner: failed to record stage failure', failRecordError)
    const willRetry = stageInfo.attempt_count < stageInfo.max_attempts
    failureInfo = {
      attemptCount: stageInfo.attempt_count,
      maxAttempts: stageInfo.max_attempts,
      retryDelaySeconds: stageInfo.retry_delay_seconds,
      priority: stageInfo.priority,
      stageStatus: willRetry ? 'error' : 'failed',
      willRetry,
      nextRetryAt: null,
      finishedAt: services.now().toISOString(),
    }
  }

  if (!classification.retryable || classification.fatal) {
    await services.moveToDeadLetter(
      queue,
      msg_id,
      jobId,
      expectedStage,
      body as QueuePayload,
      classification.fatal ? 'fatal_error' : 'non_retryable_error',
      {
        error: serializeStageError(error),
        classification: classification.reason,
        attempt: failureInfo.attemptCount,
      },
      failureInfo.attemptCount
    )
    return {
      info: failureInfo,
      status: {
        status: 'dead_lettered',
        jobId,
        stage: expectedStage,
        attempt: failureInfo.attemptCount,
        reason: classification.reason,
      },
    }
  }

  if (!failureInfo.willRetry) {
    await services.moveToDeadLetter(
      queue,
      msg_id,
      jobId,
      expectedStage,
      body as QueuePayload,
      'max_attempts_exceeded',
      {
        error: serializeStageError(error),
        classification: classification.reason,
        attempt: failureInfo.attemptCount,
      },
      failureInfo.attemptCount
    )
    return {
      info: failureInfo,
      status: {
        status: 'dead_lettered',
        jobId,
        stage: expectedStage,
        attempt: failureInfo.attemptCount,
        reason: 'max_attempts_exceeded',
      },
    }
  }

  try {
    await services.delayedRequeueJob(queue, msg_id, jobId, expectedStage, payload, {
      baseDelaySeconds: failureInfo.retryDelaySeconds,
      priorityOverride: failureInfo.priority,
      visibilitySeconds,
    })
    return {
      info: failureInfo,
      status: {
        status: 'requeued',
        jobId,
        stage: expectedStage,
        attempt: failureInfo.attemptCount,
        reason: 'retry_scheduled',
      },
    }
  } catch (requeueError) {
    console.error('stage-runner: failed to requeue stage payload, dead-lettering', requeueError)
    await services.moveToDeadLetter(
      queue,
      msg_id,
      jobId,
      expectedStage,
      body as QueuePayload,
      'requeue_failed',
      {
        error: serializeStageError(requeueError),
        original_error: serializeStageError(error),
        attempt: failureInfo.attemptCount,
      },
      failureInfo.attemptCount
    )
    return {
      info: failureInfo,
      status: {
        status: 'dead_lettered',
        jobId,
        stage: expectedStage,
        attempt: failureInfo.attemptCount,
        reason: 'requeue_failed',
      },
    }
  }
}

export async function processStageMessage<TPayload extends Record<string, unknown>>(
  options: StageRunnerOptions<TPayload>
): Promise<StageProcessingOutcome> {
  const { queue, expectedStage, message, handler } = options
  const services = options.services ?? defaultServices
  const { msg_id, message: body } = message

  const jobId = body?.job_id
  const incomingStage = body?.stage ?? expectedStage
  const payload = (body?.payload ?? {}) as TPayload

  if (!jobId) {
    console.warn('stage-runner: message missing job_id, acknowledging', { queue, msg_id })
    await services.ackMessage(queue, msg_id)
    return { status: 'invalid', stage: incomingStage ?? expectedStage }
  }

  if (incomingStage !== expectedStage) {
    await services.enqueueJob(queue, jobId, incomingStage, payload as QueuePayload, {
      priority: body?.priority ?? 0,
    })
    await services.ackMessage(queue, msg_id)
    return { status: 'forwarded', jobId, stage: incomingStage }
  }

  const stageContext = buildStageContext(queue, msg_id, services, body)
  const stageInfo = await services.startStage(jobId, expectedStage, stageContext)

  const retryOptions = resolveHandlerRetryOptions(stageInfo, options.handlerRetryOptions)

  const handlerContext: StageHandlerContext<TPayload> = {
    jobId,
    payload,
    stage: expectedStage,
    stageInfo,
    queue,
    messageId: msg_id,
    visibilitySeconds: options.visibilitySeconds,
    message: body,
  }

  try {
    const handlerResult = await retryWithStrategy(async () => handler(handlerContext), {
      ...retryOptions,
      onRetry: async (error, attempt, nextDelay) => {
        console.warn(
          `stage-runner: handler retry scheduled for job ${jobId} stage ${expectedStage} (attempt ${attempt + 1}) in ${nextDelay}ms`,
          error
        )
        if (retryOptions.onRetry) {
          await retryOptions.onRetry(error, attempt, nextDelay)
        }
      },
      shouldRetry: (error, attempt) => {
        if (retryOptions.shouldRetry && !retryOptions.shouldRetry(error, attempt)) {
          return false
        }
        const classification = classifyStageError(error)
        return classification.retryable
      },
    })

    const result = ensureHandlerResult(handlerResult)

    if (result.complete) {
      await services.completeStage(jobId, expectedStage, {
        queue,
        messageId: msg_id,
      })
      await services.ackMessage(queue, msg_id)
      return {
        status: 'completed',
        jobId,
        stage: expectedStage,
        attempt: stageInfo.attempt_count,
      }
    }

    await services.ackMessage(queue, msg_id)
    return {
      status: 'pending',
      jobId,
      stage: expectedStage,
      attempt: stageInfo.attempt_count,
    }
  } catch (error) {
    const classification = classifyStageError(error)
    const failure = await recordFailure(services, options, error, classification, stageInfo)
    return failure.status
  }
}

export async function processStageBatch<TPayload extends Record<string, unknown>>(
  messages: QueueMessage<TPayload>[],
  options: Omit<StageRunnerOptions<TPayload>, 'message'>
): Promise<StageProcessingOutcome[]> {
  return await Promise.all(
    messages.map((message) => processStageMessage({ ...options, message }))
  )
}
