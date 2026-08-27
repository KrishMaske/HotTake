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
  TARGET_GONE,
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
  slot?: number
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

/**
 * Groq model used for developer-mode replies when GROQ_MODEL is unset.
 *
 * Chosen empirically: the `gpt-oss` models on Groq are reasoning models that
 * spend the token budget before emitting content, so a short-reply prompt came
 * back empty or cut off. This one answers in character in about a second.
 * Groq retires ids periodically — override with GROQ_MODEL when it goes.
 */
const DEFAULT_GROQ_MODEL = 'qwen/qwen3.8-27b'

/**
 * Strip anything the model wraps around its actual message.
 *
 * Reasoning-style models sometimes emit a `<think>` block, and some wrap the
 * reply in quotes. Neither belongs in a chat bubble.
 */
/**
 * Assemble the chat request, guaranteeing at least one user-role turn.
 *
 * Several providers template the conversation and reject a request that has
 * no user message — Groq answers 400 "No user query found in messages". That
 * happens whenever the fixture is asked to speak into an empty conversation,
 * so instead of failing, hand it the situation and let it open.
 */
function buildMessages(
  system: string,
  turns: Array<{ role: 'user' | 'assistant'; content: string }>,
): Array<{ role: string; content: string }> {
  const head = [{ role: 'system', content: system }, ...turns]
  if (turns.some((turn) => turn.role === 'user')) return head
  return [
    ...head,
    {
      role: 'user',
      content: '(They opened the chat but have not said anything yet. Send the first message.)',
    },
  ]
}

function sanitizeReply(raw: string): string {
  return raw
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^\s*["'“”]+|["'“”]+\s*$/g, '')
    .trim()
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
    // Both branches answer identically: a fixture belonging to someone else
    // must be indistinguishable from one that does not exist.
    if (!fixture.success || !fixture.data.record) return fail(TARGET_GONE)
    if (fixture.data.record.data.ownerId !== userId) return fail(TARGET_GONE)
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
 * Batched because each write is a subrequest and fifty in a single invocation
 * would sit uncomfortably close to the worker's ceiling. The client calls this
 * in a loop until `done`, which also gives it honest progress to show.
 *
 * Work is decided by **which slots are missing**, not by how many rows exist.
 * A count is a read-then-write race: two overlapping seed loops both read the
 * same total and both write the same batch, which is exactly how a "50
 * fixtures" set grew to 95. `uniqueOn: ['ownerId', 'slot']` now makes the
 * database reject the second write, and working from the missing set means a
 * retry converges instead of appending.
 *
 * It also repairs a set that is already wrong: rows with no slot, an
 * out-of-range slot, or a duplicate slot are deleted a batch at a time.
 */
const devSeed: ActionHandler<Env> = async ({ userId, tools }) => {
  const BATCH = 10

  const mine = await requireOwnProfile(tools, userId)
  if (!mine.ok) return fail(mine.error)
  if (!isTruthy(mine.data.devMode)) return fail('Turn developer mode on first')

  const existing = await tools.query<DevProfileRow>('dev-profiles', {
    where: { ownerId: userId },
    limit: 500,
  })
  if (!existing.success) return fail(existing.error)

  // Pass 0 - sweep orphans. A synthetic match whose other participant is no
  // longer one of this user's fixtures is leftover state: either the fixture
  // was replaced, or the match predates the rule that a match requires a
  // right-swipe from both sides. Either way it should not sit in the list.
  const liveFixtureIds = new Set(existing.data.records.map((row) => row.recordId))
  const allMatches = await tools.query<MatchRow>('matches', { limit: 500 })
  if (allMatches.success) {
    const orphans = allMatches.data.records.filter((match) => {
      if (!isTruthy(match.data.synthetic)) return false
      const participants = readJsonArray(match.data.participants)
      if (!participants.includes(userId)) return false
      return participants.some((id) => id !== userId && !liveFixtureIds.has(id))
    })
    if (orphans.length > 0) {
      for (const match of orphans.slice(0, 5)) {
        await tools.deleteWhere('messages', { channelId: match.data.channelId }, 500)
        await tools.remove('channels', match.data.channelId)
        await tools.remove('matches', match.recordId)
        for (const id of readJsonArray(match.data.participants)) {
          if (id !== userId) {
            await tools.deleteWhere('swipes', { swiperId: userId, targetId: id }, 10)
          }
        }
      }
      return {
        success: true,
        data: {
          seeded: liveFixtureIds.size,
          target: DEV_PROFILE_COUNT,
          repaired: Math.min(5, orphans.length),
          done: false,
        },
      }
    }
  }

  // Pass 1 - repair. A fixture is junk when it cannot be addressed by a
  // unique in-range slot (from before the constraint existed, or a race that
  // predates it), or when it no longer fits the preferences on the profile —
  // changing who you want to see should change who is in the deck, not leave
  // people you did not ask for sitting in it.
  const bySlot = new Map<number, string>()
  const junk: string[] = []
  for (const row of existing.data.records) {
    const slot = Number(row.data.slot)
    const addressable = Number.isInteger(slot) && slot >= 0 && slot < DEV_PROFILE_COUNT
    const wanted = mutuallyCompatible(mine.data, row.data)
    if (!addressable || bySlot.has(slot) || !wanted) {
      junk.push(row.recordId)
      continue
    }
    bySlot.set(slot, row.recordId)
  }

  if (junk.length > 0) {
    // Smaller batches here: each repair also unwinds the fixture's swipe and
    // any conversation it was part of, so a row costs several subrequests.
    const batch = junk.slice(0, 5)
    const staleMatches = await tools.query<MatchRow>('matches', { limit: 200 })

    for (const recordId of batch) {
      await tools.deleteWhere('swipes', { swiperId: userId, targetId: recordId }, 10)

      // Matches created before a match required a right-swipe from both sides
      // are no longer valid state. Drop them with their fixture rather than
      // leaving orphaned conversations in the matches list.
      if (staleMatches.success) {
        for (const match of staleMatches.data.records) {
          if (!isTruthy(match.data.synthetic)) continue
          const participants = readJsonArray(match.data.participants)
          if (!participants.includes(userId)) continue
          if (!participants.includes(recordId)) continue
          await tools.deleteWhere('messages', { channelId: match.data.channelId }, 500)
          await tools.remove('channels', match.data.channelId)
          await tools.remove('matches', match.recordId)
        }
      }

      await tools.remove('dev-profiles', recordId)
    }
    return {
      success: true,
      data: {
        seeded: bySlot.size,
        target: DEV_PROFILE_COUNT,
        repaired: batch.length,
        done: false,
      },
    }
  }

  if (bySlot.size >= DEV_PROFILE_COUNT) {
    return { success: true, data: { seeded: bySlot.size, target: DEV_PROFILE_COUNT, done: true } }
  }

  // Pass 2 - fill. The run is deterministic, so slot N is always the same
  // person and a partial set completes without regenerating it.
  const wanted = readJsonArray(mine.data.interestedIn) as Gender[]
  const all = generatePersonas(DEV_PROFILE_COUNT, wanted, mine.data.gender, 1)
  const missing = all.filter((persona) => !bySlot.has(persona.slot)).slice(0, BATCH)

  let created = 0
  for (const persona of missing) {
    const result = await tools.create('dev-profiles', { ownerId: userId, ...persona })
    // A uniqueness rejection means a concurrent seed won that slot. That is
    // the constraint doing its job, not a failure worth surfacing.
    if (result.success) created++
  }

  const seeded = bySlot.size + created
  return {
    success: true,
    data: { seeded, target: DEV_PROFILE_COUNT, done: seeded >= DEV_PROFILE_COUNT },
  }
}

/**
 * Remove every fixture, match, channel, message and swipe belonging to the
 * caller's developer mode. Scoped to `ownerId`/participants, so it can only
 * ever delete the caller's own fixtures — never real data.
 */
const devReset: ActionHandler<Env> = async ({ userId, tools }) => {
  const fixtures = await tools.query<DevProfileRow>('dev-profiles', {
    where: { ownerId: userId },
    limit: 500,
  })
  if (!fixtures.success) return fail(fixtures.error)

  // Two conditions decide what to remove: the match is flagged `synthetic`,
  // and this caller is a participant. That is already proof it is developer
  // data belonging to them.
  //
  // An earlier version also required the fixture to still exist. That was a
  // bug: deleting a fixture orphaned its match, and the next reset skipped
  // the orphan because its fixture was gone — so Clear could never clear it.
  const matches = await tools.query<MatchRow>('matches', { limit: 500 })
  if (!matches.success) return fail(matches.error)

  let removedMatches = 0
  for (const match of matches.data.records) {
    if (!isTruthy(match.data.synthetic)) continue
    const participants = readJsonArray(match.data.participants)
    if (!participants.includes(userId)) continue

    await tools.deleteWhere('messages', { channelId: match.data.channelId }, 500)
    await tools.remove('channels', match.data.channelId)
    await tools.remove('matches', match.recordId)
    // The other participant is a fixture id; drop the swipe that produced it
    // so the person reappears in the stack after a reseed.
    for (const id of participants) {
      if (id !== userId) await tools.deleteWhere('swipes', { swiperId: userId, targetId: id }, 10)
    }
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
  if (!fixture.success || !fixture.data.record) return fail(TARGET_GONE)
  // RBAC is off in here: prove the caller owns this fixture before speaking as it.
  if (fixture.data.record.data.ownerId !== userId) return fail(TARGET_GONE)
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

  const model = env.GROQ_MODEL ?? DEFAULT_GROQ_MODEL

  let reply: string
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        // Roomy relative to the two-sentence reply we ask for: some models
        // spend part of the budget on reasoning tokens before any content,
        // and a tight cap returns an empty or truncated message.
        max_tokens: 200,
        temperature: 0.9,
        messages: buildMessages(system, turns),
      }),
    })

    if (!res.ok) {
      // The body can carry the provider's reason; the key is never in it.
      const detail = await res.text().catch(() => '')
      console.error(`[devReply] groq ${res.status}: ${detail.slice(0, 300)}`)
      // Distinguish the two failures that actually happen, because the remedy
      // differs. Groq retires model ids, and a stale one answers 404 — which
      // reads as "broken key" unless it is named.
      if (res.status === 404) {
        return fail(
          `The model "${model}" was not found. Groq retires model ids; set a current one with ` +
            '`deepspace secrets set GROQ_MODEL=<id>` (list them at /openai/v1/models).',
        )
      }
      if (res.status === 401 || res.status === 403) {
        return fail('Groq rejected the API key. Check GROQ_API_KEY.')
      }
      return fail(`The AI did not answer (${res.status}).`)
    }

    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    reply = sanitizeReply(body.choices?.[0]?.message?.content ?? '')
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
  devReset,
  devReply,
}
