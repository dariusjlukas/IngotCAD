/**
 * Numeric inputs that commit on blur / Enter (not on every keystroke), so a
 * single edit is one undo step and typing never floods history.
 */
import { useEffect, useRef, useState } from 'react'
import type { Vec3 } from '../document/types'

function format(n: number): string {
  return String(Math.round(n * 1000) / 1000)
}

interface NumberFieldProps {
  value: number
  onCommit: (value: number) => void
  step?: number
  min?: number
}

export function NumberField({ value, onCommit, step = 1, min }: NumberFieldProps) {
  const [text, setText] = useState(() => format(value))
  const focused = useRef(false)

  useEffect(() => {
    if (!focused.current) setText(format(value))
  }, [value])

  const commit = () => {
    const n = parseFloat(text)
    if (Number.isNaN(n)) {
      setText(format(value))
      return
    }
    onCommit(min != null ? Math.max(min, n) : n)
  }

  return (
    <input
      type="number"
      step={step}
      value={text}
      onFocus={() => {
        focused.current = true
      }}
      onBlur={() => {
        focused.current = false
        commit()
      }}
      onChange={(e) => setText(e.target.value)}
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
}

const AXES = ['X', 'Y', 'Z'] as const

export function Vec3Field({ label, value, onCommit, step, min }: Vec3FieldProps) {
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
