/**
 * Floating controls for the section view: axis, flip, and plane offset (slider
 * over the model bounds + exact numeric entry). Shown only while sectioning.
 */
import { useSectionStore } from './sectionStore'
import type { SectionAxis } from './sectionStore'
import { useFitStore } from './fitStore'
import { usePrefsStore } from '../preferences/prefsStore'
import { NumberField } from '../ui/NumberField'

const AXIS_INDEX = { x: 0, y: 1, z: 2 } as const

export function SectionPanel() {
  const enabled = useSectionStore((s) => s.enabled)
  const axis = useSectionStore((s) => s.axis)
  const offset = useSectionStore((s) => s.offset)
  const flip = useSectionStore((s) => s.flip)
  const setEnabled = useSectionStore((s) => s.setEnabled)
  const setAxis = useSectionStore((s) => s.setAxis)
  const setOffset = useSectionStore((s) => s.setOffset)
  const toggleFlip = useSectionStore((s) => s.toggleFlip)
  const bounds = useFitStore((s) => s.bounds)
  const buildVolume = usePrefsStore((s) => s.buildVolume)

  if (!enabled) return null

  const i = AXIS_INDEX[axis]
  const fallbackMin = [-buildVolume.x / 2, -buildVolume.y / 2, 0][i]
  const fallbackMax = [buildVolume.x / 2, buildVolume.y / 2, buildVolume.z][i]
  const span = bounds ? bounds.max[i] - bounds.min[i] : fallbackMax - fallbackMin
  const margin = Math.max(span * 0.05, 1)
  const min = (bounds ? bounds.min[i] : fallbackMin) - margin
  const max = (bounds ? bounds.max[i] : fallbackMax) + margin

  return (
    <div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-line-strong bg-panel/95 px-3 py-2 shadow-xl">
      <span className="text-sm font-medium text-fg">Section</span>
      <div className="flex overflow-hidden rounded border border-line-strong">
        {(['x', 'y', 'z'] as SectionAxis[]).map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => setAxis(a)}
            className={
              'px-2 py-0.5 text-sm uppercase ' +
              (axis === a ? 'bg-accent text-on-accent' : 'text-fg-muted hover:bg-elevated')
            }
          >
            {a}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={toggleFlip}
        className={
          'rounded border border-line-strong px-2 py-0.5 text-sm ' +
          (flip ? 'bg-accent text-on-accent' : 'text-fg-muted hover:bg-elevated')
        }
        title="Keep the other side"
      >
        Flip
      </button>
      <input
        type="range"
        min={min}
        max={max}
        step={(max - min) / 400}
        value={offset}
        onChange={(e) => setOffset(Number(e.target.value))}
        className="w-48 accent-accent"
        aria-label="Section plane offset"
      />
      <div className="w-20">
        <NumberField value={offset} onCommit={setOffset} live />
      </div>
      <button
        type="button"
        className="rounded px-2 py-1 text-sm text-fg-muted hover:bg-elevated"
        onClick={() => setEnabled(false)}
      >
        Close
      </button>
    </div>
  )
}
