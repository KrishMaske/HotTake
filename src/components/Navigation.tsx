/**
 * HotTake chrome: a slim top bar with the wordmark and the account menu.
 *
 * The primary navigation is the bottom tab bar (TabBar below), because the
 * whole product is thumb-shaped. Both render inside the centered mobile column
 * defined in (app)/_layout.tsx.
 *
 * The `app-navigation`, `nav-sign-in-button`, `nav-user-name` and
 * `nav-user-email` test ids are load-bearing — the shipped Playwright specs
 * assert on them, so keep them if you restyle this.
 */

import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { AuthOverlay, useAuthProfileReady, useQuery, useReadReceipts, signOut } from 'deepspace'
import type { Message } from 'deepspace'
import { Flame, Heart, LogOut, User as UserIcon } from 'lucide-react'
import { cn } from '../lib/utils'
import { rememberPostAuthPath } from '../lib/hottake'
import { useMyMatches, useMyProfile } from '../lib/use-hottake'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui'

export default function Navigation() {
  const { isLoaded, isSignedIn, user, userLoading } = useAuthProfileReady({ requireUser: true })
  const { devMode } = useMyProfile()
  const [showAuthModal, setShowAuthModal] = useState(false)
  const profileReady = !isSignedIn || (!userLoading && !!user)

  return (
    <>
      <nav
        data-testid="app-navigation"
        className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-5"
      >
        <Link to="/" className="flex items-center gap-2">
          <Flame className="h-4 w-4 text-primary" aria-hidden />
          <span className="text-sm font-bold uppercase tracking-[0.2em] text-foreground">
            HotTake
          </span>
        </Link>

        {devMode && (
          <span
            data-testid="dev-mode-chip"
            className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-primary"
          >
            Dev
          </span>
        )}

        <div className="flex-1" />

        {!isLoaded ? null : isSignedIn && !profileReady ? (
          // Signed in but the profile is still loading — a skeleton, never the
          // Sign in button (offering sign-in to a signed-in user reads as a bug).
          <div className="h-8 w-8 animate-pulse rounded-full bg-muted" />
        ) : isSignedIn && user ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  aria-label="Account menu"
                  className="rounded-full transition-opacity hover:opacity-80"
                >
                  <Avatar className="h-8 w-8 ring-1 ring-inset ring-border">
                    <AvatarImage src={user.imageUrl ?? undefined} referrerPolicy="no-referrer" />
                    <AvatarFallback className="text-[11px]">
                      {(user.name?.[0] ?? user.email?.[0] ?? '?').toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span data-testid="nav-user-name" className="sr-only">
                    {user.name || user.email}
                  </span>
                </button>
              }
            />
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <div className="truncate font-medium text-foreground">
                  {user.name || 'Signed in'}
                </div>
                <div
                  data-testid="nav-user-email"
                  className="truncate text-xs font-normal text-muted-foreground"
                >
                  {user.email}
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => signOut()}>
                <LogOut aria-hidden />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <button
            data-testid="nav-sign-in-button"
            onClick={() => {
              // OAuth navigates away; leave a crumb so the worker can send them
              // back here instead of to the app's default entry point.
              rememberPostAuthPath()
              setShowAuthModal(true)
            }}
            className="rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            Sign in
          </button>
        )}
      </nav>

      {showAuthModal && (
        <AuthOverlay
          onClose={() => setShowAuthModal(false)}
          title="Sign in to HotTake"
          description="One photo. One opinion. See who wants to argue."
        />
      )}
    </>
  )
}

const TABS = [
  { path: '/discover', label: 'Discover', icon: Flame },
  { path: '/matches', label: 'Matches', icon: Heart },
  { path: '/profile', label: 'Profile', icon: UserIcon },
] as const

/**
 * Bottom tab bar. Hidden while signed out and during onboarding, where there
 * is exactly one thing to do and a nav would only offer dead ends.
 */
export function TabBar() {
  const location = useLocation()
  const { isSignedIn } = useAuthProfileReady({ requireUser: false })
  const unread = useTotalUnread()

  if (!isSignedIn) return null
  if (location.pathname.startsWith('/onboarding')) return null
  // The conversation view owns the full column, composer included.
  if (location.pathname.startsWith('/messages/')) return null

  return (
    <nav
      data-testid="tab-bar"
      className="flex h-16 shrink-0 items-stretch border-t border-border bg-background"
    >
      {TABS.map(({ path, label, icon: Icon }) => {
        const active = location.pathname.startsWith(path)
        const badge = path === '/matches' ? unread : 0
        return (
          <Link
            key={path}
            to={path}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors',
              active ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <span className="relative">
              <Icon className="h-5 w-5" aria-hidden />
              {badge > 0 && (
                <span className="absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
                  {badge > 9 ? '9+' : badge}
                </span>
              )}
            </span>
            {label}
          </Link>
        )
      })}
    </nav>
  )
}

/**
 * Unread messages across every match the caller can see.
 *
 * Queries the collection directly rather than `useMessages(channelId)`, which
 * is per-channel. The unscoped read is safe and complete: `messages` is
 * `read: 'collaborator'`, so this only ever returns conversations this user is
 * a participant of.
 */
function useTotalUnread(): number {
  const { matches } = useMyMatches()
  const { getUnreadCount } = useReadReceipts()
  const { records: messages } = useQuery<Message>('messages')
  return matches.reduce((sum, m) => sum + getUnreadCount(m.data.channelId, messages), 0)
}
