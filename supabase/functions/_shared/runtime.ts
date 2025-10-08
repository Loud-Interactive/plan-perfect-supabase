export function runBackground(task: Promise<unknown>) {
  try {
    EdgeRuntime.waitUntil(task)
  } catch (err) {
    console.error('EdgeRuntime.waitUntil not available', err)
  }
}

export function registerBeforeUnload(handler: () => void) {
  try {
    globalThis.addEventListener('beforeunload', () => handler())
  } catch (err) {
    console.error('Failed to register beforeunload listener', err)
  }
}
