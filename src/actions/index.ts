/**
 * HotTake server actions.
 *
 * These exist because several of the app's rules cannot be enforced on the
 * client without breaking a permission rule that matters:
 *
 *  1. "You never learn who liked you before you match." `swipes` is
 *     `read: 'own'`, so the browser genuinely cannot see the reciprocal like
 *     it would need to detect a match. The check has to run somewhere with a
 *     wider view — here.
 *  2. "You can only message a match." A client that could write `messages`
 *     directly could stamp any `participants` array it liked and post into a
 *     stranger's conversation. Sending goes through `sendMessage`, which
 *     re-derives the participants from the match row.
 *  3. Developer-mode AI replies are attributed to a fixture profile, which
 *     means writing a row whose `senderId` is not the caller. Only a server
 *     action can do that safely, and only after proving the caller owns the
 *     fixture.
 *
 * IMPORTANT — the trust model (see src/server/action-routes.ts): `tools.*`
 * runs with per-record RBAC OFF. Being inside an action authorizes nothing on
 * its own. Every handler below does its own ownership check against `userId`,
 * which is the verified JWT subject and the only identity we trust.
 */

import type { ActionHandler, ActionResult } from 'deepspace/worker'
import type { Env } from '../../worker'
import { generatePersonas } from '../lib/dev-personas'
import {
  DEV_PROFILE_COUNT,
  GENDERS,
  HOT_TAKE_MAX,
  MAX_AGE,
  MIN_AGE,
  type Gender,
} from '../schemas/hottake-schemas'

type SwipeDirection = 'like' | 'pass'

interface ProfileRow extends Record<string, unknown> {
  userId: string
  displayName: string
  age: number
  hotTake: string
  photoKey: string
  gender: Gender
  interestedIn: Gender[] | string
  devMode?: boolean | number
}

interface DevProfileRow extends Record<string, unknown> {
  ownerId: string
  displayName: string
  age: number
  hotTake: string
  gender: Gender
  interestedIn: Gender[] | string
  hue: number
  persona?: string
}

interface SwipeRow extends Record<string, unknown> {
  swiperId: string
  targetId: string
  direction: SwipeDirection
}

interface MatchRow extends Record<string, unknown> {
  participants: string[] | string
  pairKey: string
  channelId: string
  synthetic?: boolean | number
}

interface MessageRow extends Record<string, unknown> {
  channelId: string
  content: string
  senderId: string
  createdAt?: string
}

/**
 * Matches are keyed by the sorted id pair so that A-to-B and B-to-A collapse
 * to the same row. Combined with `uniqueOn: ['pairKey']`, two simultaneous
 * likes can never produce two matches.
 */
function pairKeyFor(a: string, b: string): string {
  return [a, b].sort().join('::')
}

/** JSON columns arrive parsed or as a string depending on the path. */
function readJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value as string[]
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value)
      return Array.isArray(parsed) ? (parsed as string[]) : []
    } catch {
      return []
    }
  }
  return []
}

function isTruthy(value: unknown): boolean {
  return value === true || value === 1 || value === '1'
}

function fail(error: string): ActionResult {
  return { success: false, error }
}

/** Both sides have to want each other's gender for a profile to be shown. */
function mutuallyCompatible(
  a: { gender: Gender; interestedIn: Gender[] | string },
  b: { gender: Gender; interestedIn: Gender[] | string },
): boolean {
  const aWants = readJsonArray(a.interestedIn) as Gender[]
  const bWants = readJsonArray(b.interestedIn) as Gender[]
  return aWants.includes(b.gender) && bWants.includes(a.gender)
}

/** Load the caller's own profile, or fail if they have not onboarded. */
async function requireOwnProfile(
  tools: Parameters<ActionHandler<Env>>[0]['tools'],
  userId: string,
): Promise<{ ok: true; recordId: string; data: ProfileRow } | { ok: false; error: string }> {
  const res = await tools.query<ProfileRow>('profiles', { where: { userId }, limit: 1 })
  if (!res.success) return { ok: false, error: res.error }
  const row = res.data.records[0]
  if (!row) return { ok: false, error: 'Create your profile first' }
  return { ok: true, recordId: row.recordId, data: row.data }
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

/**
 * Create or update the caller's own profile.
 *
 * Profiles are one of the few things a client *can* write directly
 * (`create: true, update: 'own'`), but routing it through an action gives one
 * server-side validator for both paths — so the 18+ and length rules hold even
 * against a hand-rolled request.
 */
const saveProfile: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const displayName = typeof params.displayName === 'string' ? params.displayName.trim() : ''
  const hotTake = typeof params.hotTake === 'string' ? params.hotTake.trim() : ''
  const photoKey = typeof params.photoKey === 'string' ? params.photoKey.trim() : ''
  const age = Number(params.age)
  const gender = params.gender as Gender
  const interestedIn = readJsonArray(params.interestedIn).filter((g): g is Gender =>
    (GENDERS as readonly string[]).includes(g),
  )

  if (!displayName) return fail('Add a name so people know who they are arguing with')
  if (displayName.length > 40) return fail('Name must be 40 characters or fewer')
  if (!Number.isInteger(age)) return fail('Age must be a whole number')
  if (age < MIN_AGE) return fail(`You must be ${MIN_AGE} or older to use HotTake`)
  if (age > MAX_AGE) return fail('Enter a real age')
  if (!(GENDERS as readonly string[]).includes(gender)) return fail('Pick how you identify')
  if (interestedIn.length === 0) return fail('Pick who you want to argue with')
  if (!hotTake) return fail('A profile without a hot take is just a photo')
  if (hotTake.length > HOT_TAKE_MAX) {
    return fail(`Hot take must be ${HOT_TAKE_MAX} characters or fewer`)
  }
  if (!photoKey) return fail('Add a photo first')

  const existing = await tools.query<ProfileRow>('profiles', { where: { userId }, limit: 1 })
  if (!existing.success) return fail(existing.error)

  const patch = { displayName, age, hotTake, photoKey, gender, interestedIn }

  if (existing.data.records.length > 0) {
    const recordId = existing.data.records[0].recordId
    const updated = await tools.update('profiles', recordId, patch)
    if (!updated.success) return fail(updated.error)
    return { success: true, data: { profileId: recordId, created: false } }
  }

  const created = await tools.create('profiles', { userId, ...patch, devMode: false })
  if (!created.success) return fail(created.error)
  return { success: true, data: { profileId: created.data.recordId, created: true } }
}

// ---------------------------------------------------------------------------
// Discovery + matching
// ---------------------------------------------------------------------------

/**
 * Record a swipe and, when it completes a mutual like, create exactly one
 * match plus its DM channel.
 *
 * Returns only whether *this* swipe matched — never the fact that someone had
 * already liked the caller, because in the non-matching case that is by
 * definition not true.
 *
 * A target may be either a real user id or one of the caller's own dev-profile
 * fixtures. Fixtures match probabilistically (seeded by their id, so the answer
 * is stable) since there is nobody on the other side to reciprocate.
 */
const swipe: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const targetId = typeof params.targetId === 'string' ? params.targetId.trim() : ''
  const direction = params.direction as SwipeDirection
  if (!targetId) return fail('targetId is required')
  if (direction !== 'like' && direction !== 'pass') {
    return fail('direction must be "like" or "pass"')
  }
  if (targetId === userId) return fail('You cannot swipe on yourself')

  const mine = await requireOwnProfile(tools, userId)
  if (!mine.ok) return fail(mine.error)

  // Is the target a real profile, or one of this caller's fixtures?
  const realTarget = await tools.query<ProfileRow>('profiles', {
    where: { userId: targetId },
    limit: 1,
  })
  if (!realTarget.success) return fail(realTarget.error)

  let synthetic = false
  let targetGenderCheck: { gender: Gender; interestedIn: Gender[] | string } | null = null

  if (realTarget.data.records.length > 0) {
    targetGenderCheck = realTarget.data.records[0].data
  } else {
    const fixture = await tools.get<DevProfileRow>('dev-profiles', targetId)
    // tools.get bypasses RBAC, so ownership is checked here rather than assumed.
    if (!fixture.success || !fixture.data.record) return fail('That profile no longer exists')
    if (fixture.data.record.data.ownerId !== userId) return fail('That profile no longer exists')
    synthetic = true
    targetGenderCheck = fixture.data.record.data
  }

  // Mutual gender compatibility is a server rule, not just a client filter.
  if (!mutuallyCompatible(mine.data, targetGenderCheck)) {
    return fail('That profile is not in your preferences')
  }

  // Idempotency: uniqueOn would reject a duplicate anyway, but answering from
  // the existing row keeps a double-tap from surfacing as an error.
  const existing = await tools.query<SwipeRow>('swipes', {
    where: { swiperId: userId, targetId },
    limit: 1,
  })
  if (!existing.success) return fail(existing.error)

  if (existing.data.records.length === 0) {
    // swiperId is userBound — the room stamps it from the verified identity
    // and ignores what we pass, so a swipe cannot be attributed to anyone else.
    const created = await tools.create('swipes', { swiperId: userId, targetId, direction })
    if (!created.success) return fail(created.error)
  }

  if (direction === 'pass') return { success: true, data: { matched: false } }

  if (!synthetic) {
    // The reciprocity check the client is not permitted to make.
    const reciprocal = await tools.query<SwipeRow>('swipes', {
      where: { swiperId: targetId, targetId: userId, direction: 'like' },
      limit: 1,
    })
    if (!reciprocal.success) return fail(reciprocal.error)
    if (reciprocal.data.records.length === 0) return { success: true, data: { matched: false } }
  } else if (!fixtureLikesBack(targetId)) {
    return { success: true, data: { matched: false } }
  }

  return await createMatch(tools, userId, targetId, synthetic)
}

/**
 * Deterministic coin-flip for whether a fixture likes the developer back.
 * Stable per fixture id so re-running a swipe gives the same answer.
 */
function fixtureLikesBack(fixtureId: string): boolean {
  let hash = 0
  for (let i = 0; i < fixtureId.length; i++) {
    hash = (Math.imul(hash, 31) + fixtureId.charCodeAt(i)) | 0
  }
  return (Math.abs(hash) % 100) < 55
}

/** Create the channel + match pair, tolerating a lost uniqueness race. */
async function createMatch(
  tools: Parameters<ActionHandler<Env>>[0]['tools'],
  userId: string,
  targetId: string,
  synthetic: boolean,
): Promise<ActionResult> {
  const pairKey = pairKeyFor(userId, targetId)
  const participants = [userId, targetId].sort()

  const priorMatch = await tools.query<MatchRow>('matches', { where: { pairKey }, limit: 1 })
  if (!priorMatch.success) return fail(priorMatch.error)
  if (priorMatch.data.records.length > 0) {
    const row = priorMatch.data.records[0]
    return {
      success: true,
      data: { matched: true, matchId: row.recordId, channelId: row.data.channelId },
    }
  }

  const channel = await tools.create('channels', {
    name: `dm:${participants[0]}:${participants[1]}`,
    type: 'dm',
    description: '',
    archived: false,
    participants,
  })
  if (!channel.success) return fail(channel.error)
  const channelId = channel.data.recordId

  const match = await tools.create('matches', { participants, pairKey, channelId, synthetic })
  if (!match.success) {
    // Lost the race between the check above and here: uniqueOn rejected us.
    // Re-read, drop the orphan channel, and return the winner.
    const raced = await tools.query<MatchRow>('matches', { where: { pairKey }, limit: 1 })
    if (raced.success && raced.data.records.length > 0) {
      const row = raced.data.records[0]
      await tools.remove('channels', channelId)
      return {
        success: true,
        data: { matched: true, matchId: row.recordId, channelId: row.data.channelId },
      }
    }
    return fail(match.error)
  }

  return { success: true, data: { matched: true, matchId: match.data.recordId, channelId } }
}

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------

/**
 * Send a DM. The caller may only write into a channel belonging to a match
 * they participate in, and `participants` is copied from the match row rather
 * than taken from the request.
 */
const sendMessage: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const channelId = typeof params.channelId === 'string' ? params.channelId.trim() : ''
  const rawContent = typeof params.content === 'string' ? params.content : ''
  const content = rawContent.trim().slice(0, 2000)
  if (!channelId) return fail('channelId is required')
  if (!content) return fail('Message cannot be empty')

  const matches = await tools.query<MatchRow>('matches', { where: { channelId }, limit: 1 })
  if (!matches.success) return fail(matches.error)
  if (matches.data.records.length === 0) return fail('No such conversation')

  const participants = readJsonArray(matches.data.records[0].data.participants)
  // The authorization check. Without it this action is an open door.
  if (!participants.includes(userId)) return fail('You are not in this conversation')

  // authorId is userBound, so the room attributes this to the verified caller.
  // senderId is who it displays as, which for a human message is the same.
  const created = await tools.create('messages', {
    channelId,
    content,
    authorId: userId,
    senderId: userId,
    edited: false,
    deleted: false,
    participants,
  })
  if (!created.success) return fail(created.error)

  return { success: true, data: { messageId: created.data.recordId } }
}

// ---------------------------------------------------------------------------
// Developer mode
// ---------------------------------------------------------------------------

/** Flip developer mode on the caller's own profile. */
const setDevMode: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const enabled = isTruthy(params.enabled)
  const mine = await requireOwnProfile(tools, userId)
  if (!mine.ok) return fail(mine.error)

  const updated = await tools.update('profiles', mine.recordId, { devMode: enabled })
  if (!updated.success) return fail(updated.error)
  return { success: true, data: { devMode: enabled } }
}

/**
 * Seed fixture profiles, one batch per call.
 *
 * Batched because each create is a subrequest and fifty in a single
 * invocation would sit uncomfortably close to the worker's ceiling. The client
 * calls this in a loop until `done`, which also gives it something honest to
 * show in a progress bar.
 */
const devSeed: ActionHandler<Env> = async ({ userId, tools }) => {
  const BATCH = 10

  const mine = await requireOwnProfile(tools, userId)
  if (!mine.ok) return fail(mine.error)
  if (!isTruthy(mine.data.devMode)) return fail('Turn developer mode on first')

  const existing = await tools.query<DevProfileRow>('dev-profiles', {
    where: { ownerId: userId },
    limit: DEV_PROFILE_COUNT + 1,
  })
  if (!existing.success) return fail(existing.error)

  const alreadyHave = existing.data.records.length
  if (alreadyHave >= DEV_PROFILE_COUNT) {
    return { success: true, data: { seeded: alreadyHave, target: DEV_PROFILE_COUNT, done: true } }
  }

  const wanted = readJsonArray(mine.data.interestedIn) as Gender[]
  // Generate the full run deterministically, then take this call's slice, so
  // batches never collide or repeat.
  const all = generatePersonas(DEV_PROFILE_COUNT, wanted, mine.data.gender, 1)
  const slice = all.slice(alreadyHave, Math.min(alreadyHave + BATCH, DEV_PROFILE_COUNT))

  for (const persona of slice) {
    const created = await tools.create('dev-profiles', { ownerId: userId, ...persona })
    if (!created.success) return fail(created.error)
  }

  const seeded = alreadyHave + slice.length
  return {
    success: true,
    data: { seeded, target: DEV_PROFILE_COUNT, done: seeded >= DEV_PROFILE_COUNT },
  }
}

/**
 * Pre-match a random subset of the caller's fixtures, so developer mode has a
 * populated Matches screen without swiping through fifty cards first.
 */
const devMatch: ActionHandler<Env> = async ({ userId, tools }) => {
  const mine = await requireOwnProfile(tools, userId)
  if (!mine.ok) return fail(mine.error)
  if (!isTruthy(mine.data.devMode)) return fail('Turn developer mode on first')

  const fixtures = await tools.query<DevProfileRow>('dev-profiles', {
    where: { ownerId: userId },
    limit: DEV_PROFILE_COUNT,
  })
  if (!fixtures.success) return fail(fixtures.error)
  if (fixtures.data.records.length === 0) return fail('Seed some profiles first')

  const existingMatches = await tools.query<MatchRow>('matches', { limit: 200 })
  if (!existingMatches.success) return fail(existingMatches.error)
  const alreadyMatched = new Set(
    existingMatches.data.records.flatMap((m) => readJsonArray(m.data.participants)),
  )

  // "A random amount": between 6 and 12 of them like you back.
  const target = 6 + Math.floor(Math.random() * 7)
  const candidates = fixtures.data.records
    .filter((f) => !alreadyMatched.has(f.recordId))
    .sort(() => Math.random() - 0.5)
    .slice(0, target)

  let created = 0
  for (const fixture of candidates) {
    // Record the like as well, so the fixture leaves the discovery stack the
    // same way a real mutual like would.
    const priorSwipe = await tools.query<SwipeRow>('swipes', {
      where: { swiperId: userId, targetId: fixture.recordId },
      limit: 1,
    })
    if (priorSwipe.success && priorSwipe.data.records.length === 0) {
      await tools.create('swipes', {
        swiperId: userId,
        targetId: fixture.recordId,
        direction: 'like',
      })
    }
    const result = await createMatch(tools, userId, fixture.recordId, true)
    if (result.success) created++
  }

  return { success: true, data: { matched: created } }
}

/**
 * Remove every fixture, match, channel, message and swipe belonging to the
 * caller's developer mode. Scoped to `ownerId`/participants, so it can only
 * ever delete the caller's own fixtures — never real data.
 */
const devReset: ActionHandler<Env> = async ({ userId, tools }) => {
  const fixtures = await tools.query<DevProfileRow>('dev-profiles', {
    where: { ownerId: userId },
    limit: DEV_PROFILE_COUNT * 2,
  })
  if (!fixtures.success) return fail(fixtures.error)
  const fixtureIds = new Set(fixtures.data.records.map((f) => f.recordId))

  // Only synthetic matches, and only ones this caller participates in — the
  // query is already participant-scoped, but the synthetic flag is the guard
  // that keeps a real conversation out of the blast radius.
  const matches = await tools.query<MatchRow>('matches', { limit: 200 })
  if (!matches.success) return fail(matches.error)

  let removedMatches = 0
  for (const match of matches.data.records) {
    if (!isTruthy(match.data.synthetic)) continue
    const participants = readJsonArray(match.data.participants)
    if (!participants.includes(userId)) continue
    if (!participants.some((id) => fixtureIds.has(id))) continue

    await tools.deleteWhere('messages', { channelId: match.data.channelId }, 500)
    await tools.remove('channels', match.data.channelId)
    await tools.remove('matches', match.recordId)
    removedMatches++
  }

  for (const fixture of fixtures.data.records) {
    await tools.deleteWhere('swipes', { swiperId: userId, targetId: fixture.recordId }, 10)
    await tools.remove('dev-profiles', fixture.recordId)
  }

  return {
    success: true,
    data: { removedProfiles: fixtures.data.records.length, removedMatches },
  }
}

/**
 * Generate the fixture's next reply with Groq and write it into the
 * conversation.
 *
 * The reply is attributed to the fixture via `senderId`, while `authorId`
 * stays the developer — see the messages schema for why those differ. The key
 * lives in the app's secret store (`deepspace secrets set GROQ_API_KEY=…`),
 * never in a committed file.
 */
const devReply: ActionHandler<Env> = async ({ userId, params, tools, env }) => {
  const channelId = typeof params.channelId === 'string' ? params.channelId.trim() : ''
  if (!channelId) return fail('channelId is required')

  const matches = await tools.query<MatchRow>('matches', { where: { channelId }, limit: 1 })
  if (!matches.success) return fail(matches.error)
  const match = matches.data.records[0]
  if (!match) return fail('No such conversation')

  const participants = readJsonArray(match.data.participants)
  if (!participants.includes(userId)) return fail('You are not in this conversation')
  if (!isTruthy(match.data.synthetic)) return fail('That conversation is with a real person')

  const fixtureId = participants.find((id) => id !== userId)
  if (!fixtureId) return fail('That conversation has no other participant')

  const fixture = await tools.get<DevProfileRow>('dev-profiles', fixtureId)
  if (!fixture.success || !fixture.data.record) return fail('That profile no longer exists')
  // RBAC is off in here: prove the caller owns this fixture before speaking as it.
  if (fixture.data.record.data.ownerId !== userId) return fail('That profile no longer exists')
  const persona = fixture.data.record.data

  const apiKey = env.GROQ_API_KEY
  if (!apiKey) {
    return fail('No GROQ_API_KEY is configured. Run: deepspace secrets set GROQ_API_KEY=…')
  }

  const history = await tools.query<MessageRow>('messages', {
    where: { channelId },
    orderBy: 'createdAt',
    orderDir: 'desc',
    limit: 12,
  })
  if (!history.success) return fail(history.error)

  const mine = await requireOwnProfile(tools, userId)
  const myName = mine.ok ? mine.data.displayName : 'they'

  const turns = history.data.records
    .slice()
    .reverse()
    .map((row) => ({
      role: row.data.senderId === userId ? ('user' as const) : ('assistant' as const),
      content: row.data.content,
    }))

  const system = [
    `You are ${persona.displayName}, ${persona.age}, on a dating app called HotTake.`,
    `Your profile's hot take is: "${persona.hotTake}"`,
    `Your manner: ${persona.persona ?? 'playful and opinionated'}.`,
    `You matched with ${myName} because you both like arguing about opinions.`,
    '',
    'Reply as a real person texting on a dating app.',
    'Rules: at most two short sentences. No emoji spam, at most one.',
    'Never mention being an AI, a model, or a fixture. Stay in character.',
    'Defend your hot take, tease them, and ask something back sometimes.',
  ].join('\n')

  let reply: string
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: env.GROQ_MODEL ?? 'llama-3.3-70b-versatile',
        max_tokens: 120,
        temperature: 0.9,
        messages: [{ role: 'system', content: system }, ...turns],
      }),
    })

    if (!res.ok) {
      // The body can carry the provider's reason; the key is never in it.
      const detail = await res.text().catch(() => '')
      console.error(`[devReply] groq ${res.status}: ${detail.slice(0, 300)}`)
      return fail(`The AI did not answer (${res.status}). Check GROQ_API_KEY and GROQ_MODEL.`)
    }

    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    reply = body.choices?.[0]?.message?.content?.trim() ?? ''
  } catch (err) {
    console.error(`[devReply] groq request failed: ${err instanceof Error ? err.message : err}`)
    return fail('Could not reach the AI provider.')
  }

  if (!reply) return fail('The AI returned an empty reply.')

  const created = await tools.create('messages', {
    channelId,
    content: reply.slice(0, 2000),
    authorId: userId,
    senderId: fixtureId,
    edited: false,
    deleted: false,
    participants,
  })
  if (!created.success) return fail(created.error)

  return { success: true, data: { messageId: created.data.recordId, content: reply } }
}

export const actions: Record<string, ActionHandler<Env>> = {
  saveProfile,
  swipe,
  sendMessage,
  setDevMode,
  devSeed,
  devMatch,
  devReset,
  devReply,
}
