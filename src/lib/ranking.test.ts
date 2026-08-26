/**
 * Unit tests for discovery ranking.
 *
 * Ranking is the one part of the app with no obvious "correct" output, so the
 * tests pin the properties that matter rather than exact scores: shared topics
 * dominate, order is stable, and the privacy rule is not quietly violated by
 * the ordering.
 */

import { describe, expect, it } from 'vitest'
import { rankProfiles, scoreCandidate, sharedTopics, topicsOf } from './ranking'

const me = { age: 25, hotTake: 'Iced coffee is better in winter.' }

describe('topicsOf', () => {
  it('keeps the opinionated words and drops the filler', () => {
    const topics = topicsOf('Iced coffee is better in winter.')
    expect(topics.has('coffee')).toBe(true)
    expect(topics.has('winter')).toBe(true)
    expect(topics.has('is')).toBe(false)
    expect(topics.has('better')).toBe(false)
  })

  it('ignores punctuation and case', () => {
    expect(topicsOf('COFFEE!!!')).toEqual(topicsOf('coffee'))
  })

  it('collapses simple plurals so they count as one topic', () => {
    expect(topicsOf('concerts').has('concert')).toBe(true)
    expect(sharedTopics('I love concerts', 'a concert is fine')).toContain('concert')
  })
})

describe('sharedTopics', () => {
  it('finds the common subject of two takes', () => {
    expect(sharedTopics('Iced coffee is better in winter.', 'Tea is better than coffee.')).toContain(
      'coffee',
    )
  })

  it('is empty for unrelated takes', () => {
    expect(sharedTopics('Cats have boundaries.', 'Bagels have gotten too big.')).toEqual([])
  })

  it('puts the more specific word first', () => {
    const shared = sharedTopics(
      'Airport food is underrated because expectations are low.',
      'Airport food is fine and expectations are the problem.',
    )
    expect(shared[0].length).toBeGreaterThanOrEqual(shared[shared.length - 1].length)
  })
})

describe('scoreCandidate', () => {
  it('ranks a shared topic above a mere age match', () => {
    const sameTopic = scoreCandidate(me, {
      id: 'a',
      age: 39,
      hotTake: 'Coffee shops should not have background music.',
    })
    const sameAge = scoreCandidate(me, {
      id: 'b',
      age: 25,
      hotTake: 'Bagels have gotten too big.',
    })
    expect(sameTopic.score).toBeGreaterThan(sameAge.score)
  })

  it('explains itself when there is a shared topic', () => {
    const ranked = scoreCandidate(me, {
      id: 'a',
      age: 30,
      hotTake: 'Tea is better than coffee and coffee people know it.',
    })
    expect(ranked.reason).toBe('You both have opinions about coffee')
  })

  it('falls back to an age reason when nothing overlaps', () => {
    const ranked = scoreCandidate(me, { id: 'a', age: 25, hotTake: 'Cats have boundaries.' })
    expect(ranked.reason).toBe('Same age bracket')
  })

  it('gives no reason when nothing is notable', () => {
    const ranked = scoreCandidate(me, { id: 'a', age: 45, hotTake: 'Cats have boundaries.' })
    expect(ranked.reason).toBeUndefined()
  })

  it('decays with age distance but never goes negative', () => {
    const near = scoreCandidate(me, { id: 'a', age: 26, hotTake: 'Cats.' })
    const far = scoreCandidate(me, { id: 'a', age: 70, hotTake: 'Cats.' })
    expect(near.score).toBeGreaterThan(far.score)
    expect(far.score).toBeGreaterThanOrEqual(0)
  })

  it('boosts a brand-new profile over an old one, all else equal', () => {
    const now = Date.now()
    const fresh = scoreCandidate(
      me,
      { id: 'a', age: 40, hotTake: 'Cats.', createdAt: new Date(now - 3_600_000).toISOString() },
      now,
    )
    const stale = scoreCandidate(
      me,
      { id: 'a', age: 40, hotTake: 'Cats.', createdAt: new Date(now - 30 * 86_400_000).toISOString() },
      now,
    )
    expect(fresh.score).toBeGreaterThan(stale.score)
  })

  it('ignores a malformed createdAt instead of scoring NaN', () => {
    const ranked = scoreCandidate(me, { id: 'a', age: 30, hotTake: 'Cats.', createdAt: 'nonsense' })
    expect(Number.isFinite(ranked.score)).toBe(true)
  })
})

describe('rankProfiles', () => {
  const candidates = [
    { id: 'c', age: 44, hotTake: 'Bagels have gotten too big.' },
    { id: 'a', age: 26, hotTake: 'Coffee shops should not have background music.' },
    { id: 'b', age: 25, hotTake: 'Cats have boundaries.' },
  ]

  it('puts the shared-topic candidate first', () => {
    expect(rankProfiles(me, candidates)[0].id).toBe('a')
  })

  it('returns every candidate exactly once', () => {
    const ranked = rankProfiles(me, candidates)
    expect(ranked).toHaveLength(candidates.length)
    expect(new Set(ranked.map((r) => r.id)).size).toBe(candidates.length)
  })

  it('is stable across calls, so the stack does not reshuffle on re-render', () => {
    const now = Date.now()
    const first = rankProfiles(me, candidates, now).map((r) => r.id)
    const second = rankProfiles(me, candidates, now).map((r) => r.id)
    expect(first).toEqual(second)
  })

  it('does not depend on input order', () => {
    const now = Date.now()
    const forward = rankProfiles(me, candidates, now).map((r) => r.id)
    const reversed = rankProfiles(me, [...candidates].reverse(), now).map((r) => r.id)
    expect(forward).toEqual(reversed)
  })

  it('handles an empty stack', () => {
    expect(rankProfiles(me, [])).toEqual([])
  })

  /**
   * The privacy property, stated as a property rather than a comment.
   *
   * Ranking people who already liked you to the top is the obvious feature and
   * would leak exactly what `swipes: read: 'own'` protects, since position is
   * information. So a candidate's score must be a function of published fields
   * only: two candidates identical except for their id score the same up to
   * the deterministic tie-break jitter, and nothing swipe-shaped rides along in
   * the output.
   */
  it('scores only from published fields, so ordering cannot leak who liked you', () => {
    const a = scoreCandidate(me, { id: 'aaa', age: 30, hotTake: 'Coffee is fine.' })
    const b = scoreCandidate(me, { id: 'zzz', age: 30, hotTake: 'Coffee is fine.' })
    // Identical published data → identical score apart from the <1 jitter.
    expect(Math.abs(a.score - b.score)).toBeLessThan(1)

    // And the ranked entry carries the candidate's own fields plus rank
    // metadata — nothing else is smuggled in.
    const [entry] = rankProfiles(me, [{ id: 'a', age: 30, hotTake: 'Coffee is fine.' }])
    expect(Object.keys(entry).sort()).toEqual(
      ['age', 'hotTake', 'id', 'rankReason', 'rankScore'].sort(),
    )
  })
})
