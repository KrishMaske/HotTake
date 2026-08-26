/**
 * Client-side helpers for HotTake's server actions and shared record types.
 *
 * The SDK exposes no `useAction` hook, so this wraps the documented
 * `POST /api/actions/:name` contract (see src/server/action-routes.ts) with the
 * caller's bearer token attached. `getAuthToken()` caches and refreshes the
 * token, so this is not a round-trip per call.
 */

import { getAuthToken } from 'deepspace'
import type { Gender } from '../schemas/hottake-schemas'

export interface Profile {
  userId: string
  displayName: string
  age: number
  hotTake: string
  photoKey: string
  gender: Gender
  interestedIn: Gender[] | string
  devMode?: boolean | number
}

/** A developer-mode fixture. No photo — `hue` seeds a generated gradient. */
export interface DevProfile {
  ownerId: string
  displayName: string
  age: number
  hotTake: string
  gender: Gender
  interestedIn: Gender[] | string
  hue: number
  persona?: string
}

export interface Match {
  participants: string[] | string
  pairKey: string
  channelId: string
  synthetic?: boolean | number
}

export interface Swipe {
  swiperId: string
  targetId: string
  direction: 'like' | 'pass'
}

/**
 * One shape for "a person you can see", whether they are a real user or a
 * developer-mode fixture, so discovery and the conversation view don't each
 * need to branch on origin.
 */
export interface DisplayProfile {
  /** A real user id, or a dev-profile record id. */
  id: string
  displayName: string
  age: number
  hotTake: string
  gender: Gender
  photoKey?: string
  hue?: number
  synthetic: boolean
  /** When the underlying record was created; a ranking signal. */
  createdAt?: string
}

/** A `DisplayProfile` after `rankProfiles` has scored and explained it. */
export type RankedDisplayProfile = DisplayProfile & {
  rankScore: number
  rankReason?: string
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

/**
 * Remember where to return after OAuth.
 *
 * The SDK's `AuthOverlay` sends the browser to `/api/auth/social-redirect`
 * with no return path, so without this the worker's `oauth-complete` handler
 * has nothing to go on and falls back to /discover. Call this immediately
 * before opening the overlay.
 *
 * Not HttpOnly on purpose — it holds a path, not a credential — and the worker
 * validates it as same-origin before redirecting (see http-routes.ts).
 */
export function rememberPostAuthPath(path?: string): void {
  if (typeof document === 'undefined') return
  const target = path ?? `${window.location.pathname}${window.location.search}`
  document.cookie = `ht_post_auth=${encodeURIComponent(target)}; Path=/; Max-Age=600; SameSite=Lax`
}

/** JSON columns arrive parsed or as a string depending on the path. */
export function readJsonArray(value: unknown): string[] {
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

export function isTruthy(value: unknown): boolean {
  return value === true || value === 1 || value === '1'
}

/** The other person in a two-person match. */
export function otherParticipant(match: Match, me: string): string | undefined {
  return readJsonArray(match.participants).find((id) => id !== me)
}

/**
 * Both sides have to want each other's gender. Mirrors the server rule in
 * src/actions/index.ts.
 *
 * `interestedIn` is typed `unknown` on purpose: it is a JSON column, and the
 * record layer hands it back parsed or as a string depending on the path.
 * `readJsonArray` is the single place that reconciles those.
 */
export function mutuallyCompatible(
  a: { gender: string; interestedIn: unknown },
  b: { gender: string; interestedIn: unknown },
): boolean {
  const aWants = readJsonArray(a.interestedIn)
  const bWants = readJsonArray(b.interestedIn)
  return aWants.includes(b.gender) && bWants.includes(a.gender)
}

/**
 * A stable, pleasant gradient for a fixture profile.
 *
 * Fixtures have no photograph by design, so this has to read as a deliberate
 * design choice rather than a missing image.
 */
export function hueGradient(hue: number): string {
  const a = `hsl(${hue}, 72%, 58%)`
  const b = `hsl(${(hue + 48) % 360}, 68%, 32%)`
  return `linear-gradient(145deg, ${a} 0%, ${b} 100%)`
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
