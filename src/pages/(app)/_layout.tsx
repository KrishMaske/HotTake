/**
 * Dynamic app boundary — the auth + realtime data layer.
 *
 * `(app)` is a Generouted route group: the parentheses mean it does NOT appear
 * in the URL, so (app)/discover.tsx is served at /discover. Every page under
 * this folder is wrapped in the DeepSpace providers below, so it may call
 * `useAuth`, `useQuery`, `useMutations`, presence hooks, etc. Pages OUTSIDE it
 * (top level of src/pages/) render static, with no auth fetch and no records
 * WebSocket. Nest under (app)/(protected)/ to also require sign-in.
 *
 * Layout: HotTake is a thumb-shaped product, so the app is a fixed-width
 * mobile column. On desktop that column is centered against the page
 * background rather than stretched — a swipe card at 1400px wide is nobody's
 * idea of a dating app.
 */

import { Suspense, type ReactNode } from 'react'
import { Outlet } from 'react-router-dom'
import { DeepSpaceAuthProvider, useAuthStatus } from 'deepspace'
import { RecordProvider, RecordScope } from 'deepspace'
import Navigation, { TabBar } from '../../components/Navigation'
import { useToast } from '@/components/ui'
import { SCOPE_ID } from '../../constants'
import { schemas } from '../../schemas'

export default function AppLayout() {
  return (
    <DeepSpaceAuthProvider>
      <AuthBoot>
        <div className="flex min-h-screen justify-center bg-background">
          <div className="flex h-screen w-full max-w-[480px] flex-col overflow-hidden border-border bg-background sm:border-x">
            <Navigation />
            <main className="min-h-0 flex-1 overflow-y-auto">
              <Suspense
                fallback={
                  <div className="flex h-full items-center justify-center text-muted-foreground">
                    Loading...
                  </div>
                }
              >
                <Outlet />
              </Suspense>
            </main>
            <TabBar />
          </div>
        </div>
      </AuthBoot>
    </DeepSpaceAuthProvider>
  )
}

/**
 * Waits for auth to resolve, then mounts the data layer. Distinct from the
 * SDK's `AuthGate`.
 *
 * While the initial session check is in flight, renders a fixed full-viewport
 * panel in the theme background — visually identical to the pre-JS page, so a
 * cold load shows a steady colored screen rather than a flash.
 */
function AuthBoot({ children }: { children: ReactNode }) {
  const { isLoaded } = useAuthStatus()
  // Record writes are optimistic — they resolve before the server answers, so
  // a denied or invalid write only surfaces through onWriteError. Route
  // rejections to toasts so they are never a silent no-op.
  const { error, warning } = useToast()

  if (!isLoaded) {
    return <div aria-busy="true" className="fixed inset-0 bg-background" />
  }

  return (
    <RecordProvider
      allowAnonymous
      onWriteError={(e) =>
        e.kind === 'permission' ? warning(e.title, e.detail) : error(e.title, e.detail)
      }
    >
      <RecordScope roomId={SCOPE_ID} schemas={schemas}>
        {children}
      </RecordScope>
    </RecordProvider>
  )
}
