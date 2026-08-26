/**
 * HotTake server actions.
 *
 * These exist because two of the app's rules cannot be enforced on the client
 * without breaking a permission rule that matters:
 *
 *  1. "You never learn who liked you before you match." `swipes` is
 *     `read: 'own'`, so the browser genuinely cannot see the reciprocal like
 *     it would need to detect a match. The check has to run somewhere with a
 *     wider view — here.
 *  2. "You can only message a match." A client that could write `messages`
 *     directly could stamp any `participants` array it liked and post into a
 *     stranger's conversation. Sending goes through `sendMessage`, which
 *     re-derives the participants from the match row.
 *
 * IMPORTANT — the trust model (see src/server/action-routes.ts): `tools.*`
 * runs with per-record RBAC OFF. Being inside an action authorizes nothing on
 * its own. Every handler below therefore does its own ownership check against
 * `userId`, which is the verified JWT subject and the only identity we trust.
 */

import type { ActionHandler, ActionResult } from 'deepspace/worker'
import type { Env } from '../../worker'
import { HOT_TAKE_MAX, MAX_AGE, MIN_AGE } from '../schemas/hottake-schemas'

type SwipeDirection = 'like' | 'pass'

interface ProfileRow extends Record<string, unknown> {
  userId: string
  displayName: string
  age: number
  hotTake: string
  photoKey: string
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
}

/**
 * Matches are keyed by the sorted id pair so that A-to-B and B-to-A collapse
 * to the same row. Combined with `uniqueOn: ['pairKey']`, two simultaneous
 * likes can never produce two matches.
 */
function pairKeyFor(a: string, b: string): string {
  return [a, b].sort().join('::')
}

/** `participants` arrives parsed or as a JSON string depending on the path. */
function readParticipants(value: string[] | string | undefined): string[] {
  if (Array.isArray(value)) return value
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

function fail(error: string): ActionResult {
  return { success: false, error }
}

/**
 * Record a swipe and, when it completes a mutual like, create exactly one
 * match plus its DM channel.
 *
 * Returns only whether *this* swipe matched — never the fact that someone had
 * already liked the caller, because in the non-matching case that is by
 * definition not true.
 */
const swipe: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const targetId = typeof params.targetId === 'string' ? params.targetId.trim() : ''
  const direction = params.direction as SwipeDirection
  if (!targetId) return fail('targetId is required')
  if (direction !== 'like' && direction !== 'pass') {
    return fail('direction must be "like" or "pass"')
  }
  if (targetId === userId) return fail('You cannot swipe on yourself')

  // A swipe target must be a real, onboarded profile — otherwise a client
  // could seed swipe rows against arbitrary ids.
  const targetProfile = await tools.query<ProfileRow>('profiles', {
    where: { userId: targetId },
    limit: 1,
  })
  if (!targetProfile.success) return fail(targetProfile.error)
  if (targetProfile.data.records.length === 0) return fail('That profile no longer exists')

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

  // The reciprocity check the client is not permitted to make.
  const reciprocal = await tools.query<SwipeRow>('swipes', {
    where: { swiperId: targetId, targetId: userId, direction: 'like' },
    limit: 1,
  })
  if (!reciprocal.success) return fail(reciprocal.error)
  if (reciprocal.data.records.length === 0) return { success: true, data: { matched: false } }

  const pairKey = pairKeyFor(userId, targetId)
  const participants = [userId, targetId].sort()

  // Both users can complete the pair in the same second; check before
  // creating, and treat a lost race as success rather than an error.
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

  const match = await tools.create('matches', { participants, pairKey, channelId })
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

  const participants = readParticipants(matches.data.records[0].data.participants)
  // The authorization check. Without it this action is an open door.
  if (!participants.includes(userId)) return fail('You are not in this conversation')

  // authorId is userBound, so the room attributes this to the verified caller.
  const created = await tools.create('messages', {
    channelId,
    content,
    authorId: userId,
    edited: false,
    deleted: false,
    participants,
  })
  if (!created.success) return fail(created.error)

  return { success: true, data: { messageId: created.data.recordId } }
}

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

  if (!displayName) return fail('Add a name so people know who they are arguing with')
  if (displayName.length > 40) return fail('Name must be 40 characters or fewer')
  if (!Number.isInteger(age)) return fail('Age must be a whole number')
  if (age < MIN_AGE) return fail(`You must be ${MIN_AGE} or older to use HotTake`)
  if (age > MAX_AGE) return fail('Enter a real age')
  if (!hotTake) return fail('A profile without a hot take is just a photo')
  if (hotTake.length > HOT_TAKE_MAX) {
    return fail(`Hot take must be ${HOT_TAKE_MAX} characters or fewer`)
  }
  if (!photoKey) return fail('Add a photo first')

  const existing = await tools.query<ProfileRow>('profiles', { where: { userId }, limit: 1 })
  if (!existing.success) return fail(existing.error)

  if (existing.data.records.length > 0) {
    const recordId = existing.data.records[0].recordId
    const updated = await tools.update('profiles', recordId, {
      displayName,
      age,
      hotTake,
      photoKey,
    })
    if (!updated.success) return fail(updated.error)
    return { success: true, data: { profileId: recordId, created: false } }
  }

  const created = await tools.create('profiles', { userId, displayName, age, hotTake, photoKey })
  if (!created.success) return fail(created.error)
  return { success: true, data: { profileId: created.data.recordId, created: true } }
}

export const actions: Record<string, ActionHandler<Env>> = {
  swipe,
  sendMessage,
  saveProfile,
}
