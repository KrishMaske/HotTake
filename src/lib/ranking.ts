/**
 * Discovery ranking.
 *
 * HotTake's premise is that the interesting match is the one you would argue
 * with, so the dominant signal is **topical overlap between hot takes**: two
 * people who both have an opinion about coffee have something to open with,
 * whether or not they agree. Age proximity and profile freshness break ties.
 *
 * One signal is deliberately absent. Ranking people who already liked you to
 * the top is the obvious move and most dating apps do it — but this app's
 * stated rule is that you never learn who liked you before matching, and
 * position is information. A top-of-stack boost would leak exactly what
 * `swipes: read: 'own'` exists to protect, so ordering here uses only facts
 * both parties published.
 *
 * Pure and dependency-free so it can be unit-tested directly, and so it could
 * move server-side unchanged when discovery outgrows the client.
 */

/** Words that carry no topic. Kept short and deliberate rather than exhaustive. */
const STOPWORDS = new Set([
  'a', 'about', 'actually', 'after', 'all', 'almost', 'also', 'always', 'am', 'an', 'and', 'any',
  'anything', 'are', 'as', 'at', 'be', 'because', 'been', 'being', 'best', 'better', 'between',
  'but', 'by', 'can', 'cannot', 'do', 'does', 'doing', 'done', 'dont', 'down', 'each', 'even',
  'ever', 'every', 'everyone', 'for', 'from', 'get', 'good', 'great', 'had', 'has', 'have', 'he',
  'her', 'here', 'him', 'his', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'just', 'know',
  'like', 'made', 'make', 'me', 'more', 'most', 'much', 'must', 'my', 'never', 'no', 'nobody',
  'not', 'nothing', 'now', 'of', 'off', 'on', 'once', 'one', 'only', 'or', 'other', 'our', 'out',
  'over', 'own', 'people', 'person', 'really', 'right', 'said', 'same', 'say', 'she',
  'should', 'so', 'some', 'someone', 'something', 'still', 'such', 'take', 'than', 'that', 'the',
  'their', 'them', 'then', 'there', 'these', 'they', 'thing', 'things', 'think', 'this', 'those',
  'through', 'to', 'too', 'under', 'up', 'us', 'very', 'want', 'was', 'way', 'we', 'well', 'were',
  'what', 'when', 'where', 'which', 'while', 'who', 'why', 'will', 'with', 'would', 'you', 'your',
])

/**
 * Crude suffix stripping so "concerts" and "concert" count as the same topic.
 * Not a real stemmer — a real one is a dependency, and this only has to make
 * short opinionated sentences line up.
 */
function stem(word: string): string {
  if (word.length > 5 && word.endsWith('ies')) return `${word.slice(0, -3)}y`
  if (word.length > 4 && word.endsWith('es')) return word.slice(0, -2)
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1)
  if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3)
  if (word.length > 4 && word.endsWith('ed')) return word.slice(0, -2)
  return word
}

/** The topic words in a hot take: lowercase, de-punctuated, stopword-free. */
export function topicsOf(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)

  const topics = new Set<string>()
  for (const word of words) {
    if (word.length < 3) continue
    if (STOPWORDS.has(word)) continue
    const root = stem(word)
    if (root.length < 3) continue
    if (STOPWORDS.has(root)) continue
    topics.add(root)
  }
  return topics
}

/** Topic words two takes have in common. */
export function sharedTopics(a: string, b: string): string[] {
  const left = topicsOf(a)
  const right = topicsOf(b)
  const shared: string[] = []
  for (const topic of left) if (right.has(topic)) shared.push(topic)
  // Longer words are the more specific ones; surface those first as the reason.
  return shared.sort((x, y) => y.length - x.length)
}

/** Deterministic small jitter, so equal scores keep a stable order. */
function stableJitter(id: string): number {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (Math.imul(hash, 31) + id.charCodeAt(i)) | 0
  return (Math.abs(hash) % 100) / 100
}

export interface Rankable {
  id: string
  age: number
  hotTake: string
  /** ISO timestamp of when the profile was created, if known. */
  createdAt?: string
}

export interface Ranked<T> {
  profile: T
  score: number
  /** Short human-readable explanation, shown on the card. */
  reason?: string
}

export const RANK_WEIGHTS = {
  /** Per shared topic word, up to `topicCap` of them. */
  topic: 34,
  topicCap: 3,
  /** Full value at identical age, decaying by `agePerYear` per year apart. */
  age: 22,
  agePerYear: 2.2,
  /** Boost for profiles created within `freshHours`. */
  fresh: 9,
  freshHours: 48,
} as const

/**
 * Score one candidate against the viewer. Higher is better.
 *
 * Exported for tests and so the weighting is inspectable rather than buried
 * in a sort comparator.
 */
export function scoreCandidate(
  me: { age: number; hotTake: string },
  them: Rankable,
  now = Date.now(),
): Ranked<Rankable> {
  const shared = sharedTopics(me.hotTake, them.hotTake)
  const topicScore = Math.min(shared.length, RANK_WEIGHTS.topicCap) * RANK_WEIGHTS.topic

  const ageGap = Math.abs(me.age - them.age)
  const ageScore = Math.max(0, RANK_WEIGHTS.age - ageGap * RANK_WEIGHTS.agePerYear)

  let freshScore = 0
  if (them.createdAt) {
    const ageHours = (now - new Date(them.createdAt).getTime()) / 3_600_000
    if (Number.isFinite(ageHours) && ageHours >= 0 && ageHours < RANK_WEIGHTS.freshHours) {
      freshScore = RANK_WEIGHTS.fresh * (1 - ageHours / RANK_WEIGHTS.freshHours)
    }
  }

  const score = topicScore + ageScore + freshScore + stableJitter(them.id)

  let reason: string | undefined
  if (shared.length > 0) {
    reason = `You both have opinions about ${shared[0]}`
  } else if (ageGap <= 1) {
    reason = 'Same age bracket'
  } else if (freshScore > 0) {
    reason = 'New here'
  }

  return { profile: them, score, reason }
}

/**
 * Order the discovery stack, best first.
 *
 * Returns the candidates with their score and reason attached rather than a
 * bare sorted array, so the card can explain itself.
 */
export function rankProfiles<T extends Rankable>(
  me: { age: number; hotTake: string },
  candidates: T[],
  now = Date.now(),
): Array<T & { rankScore: number; rankReason?: string }> {
  return candidates
    .map((candidate) => {
      const { score, reason } = scoreCandidate(me, candidate, now)
      return { ...candidate, rankScore: score, rankReason: reason }
    })
    .sort((a, b) => b.rankScore - a.rankScore)
}
