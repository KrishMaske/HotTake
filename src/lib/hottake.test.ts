/**
 * Unit tests for the pure pieces of the matching rules.
 *
 * The gender rule is enforced twice — once in `useDiscoveryStack` so people
 * you cannot match with never reach your stack, and once inside the `swipe`
 * action so the rule survives a hand-rolled request. Both call the same shape
 * of predicate, so it is worth pinning down here rather than only through the
 * UI.
 */

import { describe, expect, it } from 'vitest'
import { mutuallyCompatible, readJsonArray, hueGradient, relativeTime } from './hottake'
import { generatePersonas } from './dev-personas'

describe('mutuallyCompatible', () => {
  const woman = { gender: 'woman' as const, interestedIn: ['man'] as const }
  const man = { gender: 'man' as const, interestedIn: ['woman'] as const }
  const enby = { gender: 'nonbinary' as const, interestedIn: ['woman', 'man', 'nonbinary'] as const }

  it('matches when both sides want the other', () => {
    expect(mutuallyCompatible(woman, man)).toBe(true)
    expect(mutuallyCompatible(man, woman)).toBe(true)
  })

  it('refuses when only one side is interested', () => {
    // enby wants everyone; man wants women only.
    expect(mutuallyCompatible(enby, man)).toBe(false)
    expect(mutuallyCompatible(man, enby)).toBe(false)
  })

  it('refuses when neither side is interested', () => {
    const a = { gender: 'woman' as const, interestedIn: ['woman'] as const }
    const b = { gender: 'man' as const, interestedIn: ['man'] as const }
    expect(mutuallyCompatible(a, b)).toBe(false)
  })

  it('handles interestedIn arriving as a JSON string', () => {
    const stringy = { gender: 'man' as const, interestedIn: '["woman"]' }
    expect(mutuallyCompatible(stringy, woman)).toBe(true)
  })

  it('treats an empty preference list as matching nobody', () => {
    expect(mutuallyCompatible({ gender: 'woman', interestedIn: [] as const }, man)).toBe(false)
  })
})

describe('readJsonArray', () => {
  it('passes arrays through and parses strings', () => {
    expect(readJsonArray(['a'])).toEqual(['a'])
    expect(readJsonArray('["a","b"]')).toEqual(['a', 'b'])
  })

  it('never throws on junk', () => {
    expect(readJsonArray('not json')).toEqual([])
    expect(readJsonArray('{"a":1}')).toEqual([])
    expect(readJsonArray(undefined)).toEqual([])
    expect(readJsonArray(null)).toEqual([])
  })
})

describe('generatePersonas', () => {
  it('produces exactly the requested count', () => {
    expect(generatePersonas(50, ['woman'], 'man')).toHaveLength(50)
  })

  it('only produces genders the viewer asked for', () => {
    const people = generatePersonas(30, ['woman'], 'man')
    expect(new Set(people.map((p) => p.gender))).toEqual(new Set(['woman']))
  })

  it('makes every fixture mutually compatible with the viewer', () => {
    const viewer = { gender: 'nonbinary' as const, interestedIn: ['woman', 'man'] as const }
    for (const person of generatePersonas(40, ['woman', 'man'], viewer.gender)) {
      expect(mutuallyCompatible(viewer, person)).toBe(true)
    }
  })

  it('is deterministic for the same seed, so batched seeding never repeats', () => {
    const a = generatePersonas(50, ['woman'], 'man', 1)
    const b = generatePersonas(50, ['woman'], 'man', 1)
    expect(a).toEqual(b)
  })

  it('gives every fixture a distinct display name', () => {
    const names = generatePersonas(50, ['woman', 'man', 'nonbinary'], 'woman').map(
      (p) => p.displayName,
    )
    expect(new Set(names).size).toBe(names.length)
  })

  it('keeps ages inside the adult range', () => {
    for (const person of generatePersonas(50, ['woman', 'man', 'nonbinary'], 'man')) {
      expect(person.age).toBeGreaterThanOrEqual(18)
      expect(person.age).toBeLessThan(40)
    }
  })
})

describe('presentation helpers', () => {
  it('builds a stable gradient per hue', () => {
    expect(hueGradient(120)).toBe(hueGradient(120))
    expect(hueGradient(120)).not.toBe(hueGradient(200))
  })

  it('formats relative time in compact units', () => {
    const now = Date.now()
    expect(relativeTime(new Date(now - 5_000).toISOString())).toBe('now')
    expect(relativeTime(new Date(now - 5 * 60_000).toISOString())).toBe('5m')
    expect(relativeTime(new Date(now - 3 * 3_600_000).toISOString())).toBe('3h')
    expect(relativeTime(new Date(now - 2 * 86_400_000).toISOString())).toBe('2d')
  })

  it('returns empty string for missing or invalid timestamps', () => {
    expect(relativeTime(undefined)).toBe('')
    expect(relativeTime('not a date')).toBe('')
  })
})
