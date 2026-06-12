import { describe, expect, it } from 'vitest'
import { RequestQueue } from './requestQueue'

/** A manually-settled job so tests control completion order. */
function job<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('RequestQueue', () => {
  it('runs immediately when the key is idle', async () => {
    const q = new RequestQueue()
    const result = await q.submit('a', () => Promise.resolve(1))
    expect(result).toBe(1)
  })

  it('bypasses coalescing for null keys', async () => {
    const q = new RequestQueue()
    const first = job<number>()
    let runs = 0
    const p1 = q.submit(null, () => {
      runs++
      return first.promise
    })
    const p2 = q.submit(null, () => {
      runs++
      return Promise.resolve(2)
    })
    expect(runs).toBe(2) // both ran without waiting
    first.resolve(1)
    expect(await p1).toBe(1)
    expect(await p2).toBe(2)
  })

  it('queues one successor and runs it after the in-flight job settles', async () => {
    const q = new RequestQueue()
    const first = job<number>()
    let secondRan = false
    const p1 = q.submit('k', () => first.promise)
    const p2 = q.submit('k', () => {
      secondRan = true
      return Promise.resolve(2)
    })
    expect(secondRan).toBe(false) // not started while first is in flight
    first.resolve(1)
    expect(await p1).toBe(1)
    expect(await p2).toBe(2)
    expect(secondRan).toBe(true)
  })

  it('latest wins: a displaced request never runs and resolves with the newest result', async () => {
    const q = new RequestQueue()
    const first = job<string>()
    const runs: string[] = []
    const p1 = q.submit('k', () => {
      runs.push('first')
      return first.promise
    })
    const p2 = q.submit('k', () => {
      runs.push('second')
      return Promise.resolve('second-result')
    })
    const p3 = q.submit('k', () => {
      runs.push('third')
      return Promise.resolve('third-result')
    })
    first.resolve('first-result')
    expect(await p1).toBe('first-result')
    // The second submission was displaced by the third: it never ran, and its
    // caller got the newest result.
    expect(await p2).toBe('third-result')
    expect(await p3).toBe('third-result')
    expect(runs).toEqual(['first', 'third'])
  })

  it('continues the queue after a failure and rejects only the failed caller', async () => {
    const q = new RequestQueue()
    const first = job<number>()
    const p1 = q.submit('k', () => first.promise)
    const p2 = q.submit('k', () => Promise.resolve(2))
    first.reject(new Error('boom'))
    await expect(p1).rejects.toThrow('boom')
    expect(await p2).toBe(2)
  })

  it('different keys do not coalesce', async () => {
    const q = new RequestQueue()
    const first = job<number>()
    let bRan = false
    void q.submit('a', () => first.promise)
    const pb = q.submit('b', () => {
      bRan = true
      return Promise.resolve(2)
    })
    expect(bRan).toBe(true)
    expect(await pb).toBe(2)
    first.resolve(1)
  })
})
