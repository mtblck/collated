/** Thrown when work in a worker took too long and the worker was stopped. */
export class TimeoutError extends Error {
  override name = 'TimeoutError'
}

/**
 * Settles with `work`, or rejects with a TimeoutError after `ms` — calling
 * `onTimeout` first, so the caller can terminate the stuck worker and let the
 * next attempt start fresh.
 */
export const withTimeout = <T>(
  work: Promise<T>,
  ms: number,
  message: string,
  onTimeout: () => void,
): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout()
      reject(new TimeoutError(message))
    }, ms)
    work.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
