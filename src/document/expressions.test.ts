import { describe, expect, it } from 'vitest'
import { evaluateExpression, isValidName, referencedNames, resolveVariables } from './expressions'

describe('evaluateExpression', () => {
  it('handles arithmetic with precedence', () => {
    expect(evaluateExpression('2 + 3 * 4')).toBe(14)
    expect(evaluateExpression('(2 + 3) * 4')).toBe(20)
    expect(evaluateExpression('10 - 4 - 3')).toBe(3) // left-assoc
    expect(evaluateExpression('2 ^ 3 ^ 2')).toBe(512) // right-assoc
    expect(evaluateExpression('-3 + 5')).toBe(2)
    expect(evaluateExpression('7 % 4')).toBe(3)
  })

  it('resolves variables and pi', () => {
    expect(evaluateExpression('wall * 2 + clearance', { wall: 2.4, clearance: 0.2 })).toBeCloseTo(5)
    expect(evaluateExpression('pi')).toBeCloseTo(Math.PI)
  })

  it('supports functions; trig is in degrees', () => {
    expect(evaluateExpression('sqrt(2)')).toBeCloseTo(Math.SQRT2)
    expect(evaluateExpression('min(3, 7, 2)')).toBe(2)
    expect(evaluateExpression('max(3, 7)')).toBe(7)
    expect(evaluateExpression('sin(30)')).toBeCloseTo(0.5)
    expect(evaluateExpression('cos(60)')).toBeCloseTo(0.5)
    expect(evaluateExpression('round(2.6)')).toBe(3)
  })

  it('rejects bad input clearly', () => {
    expect(() => evaluateExpression('')).toThrow()
    expect(() => evaluateExpression('2 +')).toThrow()
    expect(() => evaluateExpression('foo + 1')).toThrow(/Unknown variable/)
    expect(() => evaluateExpression('bogus(1)')).toThrow(/Unknown function/)
    expect(() => evaluateExpression('2 * (3')).toThrow(/Missing/)
    expect(() => evaluateExpression('1 / 0 * 0')).toThrow(/finite/)
    expect(() => evaluateExpression('2; alert(1)')).toThrow()
  })

  it('never evaluates JavaScript', () => {
    expect(() => evaluateExpression('window')).toThrow(/Unknown variable/)
    expect(() => evaluateExpression('constructor')).toThrow(/Unknown variable/)
  })
})

describe('referencedNames', () => {
  it('lists variables but not functions or constants', () => {
    expect(referencedNames('wall * 2 + min(a, pi)').sort()).toEqual(['a', 'wall'])
  })
})

describe('isValidName', () => {
  it('accepts identifiers, rejects reserved and malformed names', () => {
    expect(isValidName('wall')).toBe(true)
    expect(isValidName('wall_2')).toBe(true)
    expect(isValidName('2wall')).toBe(false)
    expect(isValidName('pi')).toBe(false)
    expect(isValidName('sin')).toBe(false)
    expect(isValidName('a b')).toBe(false)
  })
})

describe('resolveVariables', () => {
  it('resolves chains regardless of declaration order', () => {
    const { values, errors } = resolveVariables([
      { name: 'total', expr: 'wall * 2 + gap' },
      { name: 'gap', expr: '0.2' },
      { name: 'wall', expr: '2.4' },
    ])
    expect(errors).toEqual({})
    expect(values.total).toBeCloseTo(5)
  })

  it('flags cycles without poisoning healthy variables', () => {
    const { values, errors } = resolveVariables([
      { name: 'a', expr: 'b + 1' },
      { name: 'b', expr: 'a + 1' },
      { name: 'ok', expr: '7' },
    ])
    expect(values.ok).toBe(7)
    expect(errors.a).toMatch(/Circular/)
    expect(errors.b).toMatch(/Circular/)
  })

  it('flags unknown references per-variable', () => {
    const { values, errors } = resolveVariables([
      { name: 'good', expr: '1' },
      { name: 'bad', expr: 'nope * 2' },
    ])
    expect(values.good).toBe(1)
    expect(errors.bad).toMatch(/Circular|Unknown/)
  })
})
