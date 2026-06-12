/**
 * A numeric field that also accepts variable expressions ("wall * 2"). The
 * document keeps storing a plain number; an expression input additionally
 * creates a binding (see document/bindings.ts) so the field follows future
 * variable edits. Typing a plain number clears the binding again. Bound fields
 * render the expression with an accent tint; the computed number shows in the
 * tooltip.
 */
import { useEffect, useRef, useState } from 'react'
import { useCadStore } from '../document/store'
import { bindingKey } from '../document/bindings'
import type { NodeId } from '../document/types'
import { toast } from './toastStore'

function format(n: number): string {
  return String(Math.round(n * 1000) / 1000)
}

interface ExprFieldProps {
  /** Owning node + dot path of the numeric field (the binding identity). */
  nodeId: NodeId
  path: string
  value: number
  /** Commit a plain (unbound) number — the field's normal setter. */
  onCommit: (value: number) => void
  min?: number
  step?: number
}

export function ExprField({ nodeId, path, value, onCommit, min, step = 1 }: ExprFieldProps) {
  const key = bindingKey(nodeId, path)
  const binding = useCadStore((s) => s.doc.bindings[key])
  const setFieldBinding = useCadStore((s) => s.setFieldBinding)
  const [text, setText] = useState(() => binding ?? format(value))
  const focused = useRef(false)

  useEffect(() => {
    if (!focused.current) setText(binding ?? format(value))
  }, [binding, value])

  const commit = (raw: string) => {
    const trimmed = raw.trim()
    if (trimmed === '') {
      setText(binding ?? format(value))
      return
    }
    const asNumber = Number(trimmed)
    if (!Number.isNaN(asNumber)) {
      const clamped = min != null ? Math.max(min, asNumber) : asNumber
      if (binding) {
        // One undo step: drop the binding and write the typed number.
        setFieldBinding(nodeId, path, null, clamped)
      } else if (clamped !== value) {
        onCommit(clamped)
      }
      setText(format(clamped))
      return
    }
    // Not a number: treat as an expression.
    if (!setFieldBinding(nodeId, path, trimmed)) {
      toast.error(`Can't evaluate "${trimmed}" — check variable names.`)
      setText(binding ?? format(value))
    }
  }

  return (
    <input
      type="text"
      inputMode="text"
      step={step}
      value={text}
      title={binding ? `${binding} = ${format(value)}` : undefined}
      onFocus={() => {
        focused.current = true
      }}
      onBlur={() => {
        focused.current = false
        commit(text)
      }}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        else if (e.key === 'Escape') {
          setText(binding ?? format(value))
          e.currentTarget.blur()
        }
      }}
      className={
        'w-full rounded px-1.5 py-1 text-sm tabular-nums outline-none focus:ring-1 focus:ring-accent-ring ' +
        (binding ? 'bg-selection font-mono text-fg-strong' : 'bg-elevated text-fg-strong')
      }
    />
  )
}

interface ExprVec3FieldProps {
  label: string
  nodeId: NodeId
  /** Dot path of the Vec3 (e.g. "params.size"); components bind as `.0/.1/.2`. */
  basePath: string
  value: [number, number, number]
  onCommit: (value: [number, number, number]) => void
  min?: number
  step?: number
}

const AXES = ['X', 'Y', 'Z'] as const

/** Vec3Field's expression-capable sibling: each axis binds independently. */
export function ExprVec3Field({
  label,
  nodeId,
  basePath,
  value,
  onCommit,
  min,
  step,
}: ExprVec3FieldProps) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium uppercase tracking-wide text-fg-faint">{label}</div>
      <div className="flex gap-1.5">
        {AXES.map((axis, i) => (
          <label key={axis} className="flex flex-1 items-center gap-1">
            <span className="text-xs text-fg-faint">{axis}</span>
            <ExprField
              nodeId={nodeId}
              path={`${basePath}.${i}`}
              value={value[i]}
              min={min}
              step={step}
              onCommit={(v) => {
                const next = [...value] as [number, number, number]
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
