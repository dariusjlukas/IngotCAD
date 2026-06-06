/**
 * Numeric inputs. By default they commit on blur / Enter (not on every
 * keystroke), so a single edit is one undo step and typing never floods history.
 *
 * Pass `live` to commit on every change instead — typing, arrow keys, and
 * mouse-wheel scrubbing update the geometry as you go. The whole gesture still
 * collapses to a single undo step: the field brackets it with the store's
 * beginLiveEdit/endLiveEdit so history doesn't flood.
 */
import { useEffect, useRef, useState } from 'react'
import type { Vec3 } from '../document/types'
import { useCadStore } from '../document/store'

function format(n: number): string {
  return String(Math.round(n * 1000) / 1000)
}

interface NumberFieldProps {
  value: number
  onCommit: (value: number) => void
  step?: number
  min?: number
  /** Commit on every change (mouse-wheel / arrow keys / typing), not just on blur. */
  live?: boolean
}

export function NumberField({ value, onCommit, step = 1, min, live }: NumberFieldProps) {
  const [text, setText] = useState(() => format(value))
  const focused = useRef(false)

  useEffect(() => {
    if (!focused.current) setText(format(value))
  }, [value])

  // If we unmount mid-gesture (e.g. the selection changes while focused), close
  // the live-edit so history coalescing doesn't stay stuck on.
  useEffect(() => {
    return () => {
      if (live && focused.current) useCadStore.getState().endLiveEdit()
    }
  }, [live])

  /** Parse + clamp the raw text; null when it isn't a usable number yet. */
  const clamp = (raw: string): number | null => {
    const n = parseFloat(raw)
    if (Number.isNaN(n)) return null
    return min != null ? Math.max(min, n) : n
  }

  return (
    <input
      type="number"
      step={step}
      value={text}
      onFocus={() => {
        focused.current = true
        if (live) useCadStore.getState().beginLiveEdit()
      }}
      onBlur={() => {
        focused.current = false
        const n = clamp(text)
        if (n == null) setText(format(value))
        else if (n !== value) onCommit(n)
        if (live) useCadStore.getState().endLiveEdit()
      }}
      onChange={(e) => {
        const raw = e.target.value
        setText(raw)
        // Live: commit as you scrub, but skip un-parseable intermediates ("",
        // "-", "1.") so the field doesn't fight you mid-type.
        if (live) {
          const n = clamp(raw)
          if (n != null && n !== value) onCommit(n)
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
      className="w-full rounded bg-elevated px-1.5 py-1 text-sm tabular-nums text-fg-strong outline-none focus:ring-1 focus:ring-accent-ring"
    />
  )
}

interface Vec3FieldProps {
  label: string
  value: Vec3
  onCommit: (value: Vec3) => void
  step?: number
  min?: number
  live?: boolean
}

const AXES = ['X', 'Y', 'Z'] as const

export function Vec3Field({ label, value, onCommit, step, min, live }: Vec3FieldProps) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium uppercase tracking-wide text-fg-faint">{label}</div>
      <div className="flex gap-1.5">
        {AXES.map((axis, i) => (
          <label key={axis} className="flex flex-1 items-center gap-1">
            <span className="text-xs text-fg-faint">{axis}</span>
            <NumberField
              value={value[i]}
              step={step}
              min={min}
              live={live}
              onCommit={(v) => {
                const next = [...value] as Vec3
                next[i] = v
                onCommit(next)
              }}
            />
          </label>
        ))}
      </div>
    </div>
  )
}
