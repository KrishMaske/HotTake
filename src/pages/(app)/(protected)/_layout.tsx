/**
 * Gated routes. Any file under src/pages/(app)/(protected)/ requires sign-in.
 * `(protected)` is a Generouted route group, so it doesn't appear in the URL.
 *
 * On top of sign-in this layout adds HotTake's second gate: you need a profile
 * before you can see anyone else's. A signed-in user without one is sent to
 * /onboarding. That is a routing convenience, not a security control — the
 * real boundary is that `profiles` denies reads to non-members and the swipe
 * action refuses targets that have no profile row.
 */

import { useState } from 'react'
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom'
import { AuthGate, AuthOverlay } from 'deepspace'
import { Flame } from 'lucide-react'
import { useMyProfile } from '../../../lib/use-hottake'

export default function ProtectedLayout() {
  return (
    <AuthGate fallback={<SignedOutPanel />}>
      <ProfileGate />
    </AuthGate>
  )
}

function ProfileGate() {
  const { profile, loading } = useMyProfile()
  const location = useLocation()
  const onOnboarding = location.pathname.startsWith('/onboarding')

  // Hold the frame rather than flashing onboarding at someone who has a
  // profile the query hasn't returned yet.
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Flame className="h-6 w-6 animate-pulse text-primary" aria-hidden />
        <span className="sr-only">Loading</span>
      </div>
    )
  }

  if (!profile && !onOnboarding) return <Navigate to="/onboarding" replace />
  if (profile && onOnboarding) return <Navigate to="/discover" replace />

  return <Outlet />
}

function SignedOutPanel() {
  const [showAuthModal, setShowAuthModal] = useState(false)

  return (
    <div className="flex h-full flex-col items-center justify-center px-8 text-center">
      <Flame className="mb-5 h-8 w-8 text-primary" aria-hidden />
      <h1 className="text-xl font-bold text-foreground">Sign in to start arguing</h1>
      <p className="mt-2 max-w-xs text-sm text-muted-foreground">
        You need an account to see who else has opinions worth defending.
      </p>
      <button
        onClick={() => setShowAuthModal(true)}
        className="mt-7 w-full max-w-xs rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
      >
        Sign in
      </button>
      <Link
        to="/"
        className="mt-4 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        Back to home
      </Link>

      {showAuthModal && <AuthOverlay onClose={() => setShowAuthModal(false)} />}
    </div>
  )
}
