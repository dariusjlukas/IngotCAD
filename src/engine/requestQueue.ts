/**
 * Latest-wins request coalescing, keyed by an arbitrary string.
 *
 * While a request for a key is in flight, at most ONE successor is queued; a
 * newer submission displaces the queued one, and the displaced caller's promise
 * is chained to the newest result (every caller eventually settles, with the
 * freshest data). This is the worker-backpressure strategy: a synchronous WASM
 * evaluation cannot be cancelled mid-job, so superseded work is simply never
 * posted.
 *
 * Pure and engine-agnostic so it can be unit-tested without a Worker.
 */

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

interface Slot {
  next: { run: () => Promise<unknown>; deferred: Deferred<unknown> } | null
}

export class RequestQueue {
  /** A key is present here exactly while a request for it is in flight. */
  private slots = new Map<string, Slot>()

  /**
   * Run `run` now, or queue it (latest-wins) if a request with the same key is
   * already in flight. `key: null` bypasses coalescing entirely.
   */
  submit<T>(key: string | null, run: () => Promise<T>): Promise<T> {
    if (key === null) return run()
    const slot = this.slots.get(key)
    if (!slot) {
      this.slots.set(key, { next: null })
      const promise = run()
      promise.then(
        () => this.onSettled(key),
        () => this.onSettled(key),
      )
      return promise
    }
    const deferred = createDeferred<T>()
    if (slot.next) {
      // Displaced: that caller gets whatever the newest request produces.
      slot.next.deferred.resolve(deferred.promise)
    }
    slot.next = { run, deferred: deferred as Deferred<unknown> }
    return deferred.promise
  }

  private onSettled(key: string): void {
    const slot = this.slots.get(key)
    if (!slot) return
    const next = slot.next
    if (!next) {
      this.slots.delete(key)
      return
    }
    slot.next = null
    const promise = next.run()
    next.deferred.resolve(promise)
    promise.then(
      () => this.onSettled(key),
      () => this.onSettled(key),
    )
  }
}
