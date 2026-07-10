import { beforeEach, describe, expect, it } from 'vitest'
import { setStaleFaceStatuses, useFaceRefStatusStore } from './faceRefStatusStore'
import type { StaleFaceInfo } from './faceRefStatusStore'

const moved = (z: number): StaleFaceInfo => ({
  status: 'moved',
  label: 'Plane 1',
  rebind: {
    origin: [0, 0, z],
    normal: [0, 0, 1],
    localNormal: [0, 0, 1],
    localOffset: z,
  },
})

beforeEach(() => {
  useFaceRefStatusStore.setState({ stale: {} })
})

describe('setStaleFaceStatuses', () => {
  it('publishes a fresh rebind frame when a face moves a second time', () => {
    // Regression: change detection compared only keys and statuses, so the
    // second move (same key, same 'moved' status, NEW frame) was dropped and
    // "Rebind to face" kept writing the first move's outdated plane forever.
    setStaleFaceStatuses({ p1: moved(12) })
    expect(useFaceRefStatusStore.getState().stale.p1.rebind?.localOffset).toBe(12)

    setStaleFaceStatuses({ p1: moved(14) })
    expect(useFaceRefStatusStore.getState().stale.p1.rebind?.localOffset).toBe(14)
  })

  it('clears statuses when everything is healthy again', () => {
    setStaleFaceStatuses({ p1: moved(12) })
    setStaleFaceStatuses({})
    expect(useFaceRefStatusStore.getState().stale).toEqual({})
  })
})
