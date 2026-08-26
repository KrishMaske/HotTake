/**
 * Client-side helpers for HotTake's server actions and shared record types.
 *
 * The SDK exposes no `useAction` hook, so this wraps the documented
 * `POST /api/actions/:name` contract (see src/server/action-routes.ts) with the
 * caller's bearer token attached. `getAuthToken()` caches and refreshes the
 * token, so this is not a round-trip per call.
 */

import { getAuthToken } from 'deepspace'

export interface Profile {
  userId: string
  displayName: string
  age: number
  hotTake: string
  photoKey: string
}

export interface Match {
  participants: string[] | string
  pairKey: string
  channelId: string
}

export interface Swipe {
  swiperId: string
  targetId: string
  direction: 'like' | 'pass'
}

export interface SwipeResult {
  matched: boolean
  matchId?: string
  channelId?: string
}

/** Thrown for any non-success action outcome so callers can `catch` uniformly. */
export class ActionError extends Error {}

/**
 * Call a server action. Resolves with the action's `data` on success and
 * throws `ActionError` with the server's message otherwise — including for
 * HTTP-level failures, so a caller never has to distinguish the two.
 */
export async function callAction<T>(name: string, params: Record<string, unknown>): Promise<T> {
  const token = await getAuthToken()
  if (!token) throw new ActionError('Your session expired. Sign in again.')

  let response: Response
  try {
    response = await fetch(`/api/actions/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(params),
    })
  } catch {
    throw new ActionError('Network error. Check your connection and try again.')
  }

  if (response.status === 401) throw new ActionError('Your session expired. Sign in again.')
  if (!response.ok && response.status !== 400) {
    throw new ActionError(`Something went wrong (${response.status}). Try again.`)
  }

  const body = (await response.json().catch(() => null)) as
    | { success: true; data: T }
    | { success: false; error: string }
    | null

  if (!body) throw new ActionError('The server sent back something unreadable.')
  if (!body.success) throw new ActionError(body.error)
  return body.data
}

/** `participants` arrives parsed or as a JSON string depending on the path. */
export function readParticipants(value: string[] | string | undefined): string[] {
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

/** The other person in a two-person match. */
export function otherParticipant(match: Match, me: string): string | undefined {
  return readParticipants(match.participants).find((id) => id !== me)
}

/** Compact relative time for match and message lists ("2m", "3h", "5d"). */
export function relativeTime(iso: string | undefined): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000))
  if (seconds < 60) return 'now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return `${Math.floor(days / 7)}w`
}

/** Clock time for message bubbles. */
export function clockTime(iso: string | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}
