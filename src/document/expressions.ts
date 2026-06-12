/**
 * A tiny, safe arithmetic-expression engine for document variables and
 * dimension bindings ("wall * 2 + clearance"). Hand-rolled recursive descent —
 * never eval() — supporting + - * / % ^, parentheses, named variables, a few
 * functions, and the constant pi. Trig works in DEGREES (this is a CAD app).
 *
 * Pure module: no store, no three.js — unit-testable directly.
 */

import type { DocVariable } from './types'

/** Resolved variable values, by name. */
export type Scope = Record<string, number>

const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  min: Math.min,
  max: Math.max,
  // Degrees in, degrees out where applicable.
  sin: (d) => Math.sin((d * Math.PI) / 180),
  cos: (d) => Math.cos((d * Math.PI) / 180),
  tan: (d) => Math.tan((d * Math.PI) / 180),
}

const CONSTANTS: Scope = { pi: Math.PI }

/** Own-property lookup — `in`/bracket access would leak Object.prototype
 *  members ("constructor", "toString", …) into the expression namespace. */
const own = <T>(obj: Record<string, T>, key: string): T | undefined =>
  Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined

export class ExprError extends Error {}

/** Valid variable identifier: letter/underscore start, then word chars. */
export function isValidName(name: string): boolean {
  return (
    /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) &&
    own(FUNCTIONS, name) === undefined &&
    own(CONSTANTS, name) === undefined
  )
}

type Token =
  | { kind: 'num'; value: number }
  | { kind: 'name'; value: string }
  | { kind: 'op'; value: string }

function tokenize(src: string): Token[] {
  const out: Token[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) {
      i++
      continue
    }
    if (/[0-9.]/.test(c)) {
      const m = /^[0-9]*\.?[0-9]+/.exec(src.slice(i))
      if (!m) throw new ExprError(`Bad number at "${src.slice(i, i + 8)}"`)
      out.push({ kind: 'num', value: parseFloat(m[0]) })
      i += m[0].length
      continue
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!
      out.push({ kind: 'name', value: m[0] })
      i += m[0].length
      continue
    }
    if ('+-*/%^(),'.includes(c)) {
      out.push({ kind: 'op', value: c })
      i++
      continue
    }
    throw new ExprError(`Unexpected character "${c}"`)
  }
  return out
}

/**
 * Evaluate an expression against resolved variable values. Throws ExprError on
 * syntax errors, unknown names, or a non-finite result.
 */
export function evaluateExpression(expr: string, scope: Scope = {}): number {
  const tokens = tokenize(expr)
  if (tokens.length === 0) throw new ExprError('Empty expression')
  let pos = 0

  const peek = () => tokens[pos]
  const takeOp = (value: string): boolean => {
    const t = tokens[pos]
    if (t?.kind === 'op' && t.value === value) {
      pos++
      return true
    }
    return false
  }

  // expr := term (('+'|'-') term)*
  const parseExpr = (): number => {
    let v = parseTerm()
    for (;;) {
      if (takeOp('+')) v += parseTerm()
      else if (takeOp('-')) v -= parseTerm()
      else return v
    }
  }
  // term := unary (('*'|'/'|'%') unary)*
  const parseTerm = (): number => {
    let v = parseUnary()
    for (;;) {
      if (takeOp('*')) v *= parseUnary()
      else if (takeOp('/')) v /= parseUnary()
      else if (takeOp('%')) v %= parseUnary()
      else return v
    }
  }
  // unary := ('-'|'+') unary | power
  const parseUnary = (): number => {
    if (takeOp('-')) return -parseUnary()
    if (takeOp('+')) return parseUnary()
    return parsePower()
  }
  // power := primary ('^' unary)?   (right-associative)
  const parsePower = (): number => {
    const base = parsePrimary()
    if (takeOp('^')) return Math.pow(base, parseUnary())
    return base
  }
  const parsePrimary = (): number => {
    const t = peek()
    if (!t) throw new ExprError('Unexpected end of expression')
    if (t.kind === 'num') {
      pos++
      return t.value
    }
    if (t.kind === 'name') {
      pos++
      if (takeOp('(')) {
        const fn = own(FUNCTIONS, t.value)
        if (!fn) throw new ExprError(`Unknown function "${t.value}"`)
        const args: number[] = []
        if (!takeOp(')')) {
          do {
            args.push(parseExpr())
          } while (takeOp(','))
          if (!takeOp(')')) throw new ExprError('Missing ")"')
        }
        return fn(...args)
      }
      const constant = own(CONSTANTS, t.value)
      if (constant !== undefined) return constant
      const value = own(scope, t.value)
      if (value !== undefined) return value
      throw new ExprError(`Unknown variable "${t.value}"`)
    }
    if (takeOp('(')) {
      const v = parseExpr()
      if (!takeOp(')')) throw new ExprError('Missing ")"')
      return v
    }
    throw new ExprError(`Unexpected "${t.value}"`)
  }

  const result = parseExpr()
  if (pos !== tokens.length) {
    const t = tokens[pos]
    throw new ExprError(`Unexpected "${t.kind === 'num' ? t.value : t.value}"`)
  }
  if (!Number.isFinite(result)) throw new ExprError('Result is not a finite number')
  return result
}

/** Variable names an expression references (for dependency ordering). */
export function referencedNames(expr: string): string[] {
  try {
    const out = new Set<string>()
    const tokens = tokenize(expr)
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i]
      const next = tokens[i + 1]
      if (
        t.kind === 'name' &&
        own(CONSTANTS, t.value) === undefined &&
        !(next?.kind === 'op' && next.value === '(')
      ) {
        out.add(t.value)
      }
    }
    return [...out]
  } catch {
    return []
  }
}

/**
 * Resolve a variable list (expressions may reference earlier OR later
 * variables) into concrete values. Returns per-variable errors for cycles,
 * unknown references, and syntax problems — healthy variables still resolve.
 */
export function resolveVariables(vars: DocVariable[]): {
  values: Scope
  errors: Record<string, string>
} {
  const values: Scope = {}
  const errors: Record<string, string> = {}
  const pending = new Map(vars.map((v) => [v.name, v.expr]))

  // Iterate: each pass resolves every variable whose references are all known.
  for (let pass = 0; pass < vars.length && pending.size > 0; pass++) {
    let progressed = false
    for (const [name, expr] of [...pending]) {
      const refs = referencedNames(expr)
      if (refs.some((r) => pending.has(r) && r !== name)) continue // wait for deps
      try {
        values[name] = evaluateExpression(expr, values)
      } catch (err) {
        errors[name] = err instanceof Error ? err.message : String(err)
      }
      pending.delete(name)
      progressed = true
    }
    if (!progressed) break
  }
  for (const name of pending.keys()) {
    errors[name] = 'Circular reference'
  }
  return { values, errors }
}
