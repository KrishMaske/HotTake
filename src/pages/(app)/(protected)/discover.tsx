/**
 * Discovery — the swipe stack.
 *
 * The eligible set is computed client-side from two live queries: every
 * profile, and *my own* swipes. That is safe precisely because `swipes` is
 * `read: 'own'` — the swipe rows arriving here are only ever the caller's, so
 * "who have I already judged" is answerable locally while "who liked me"
 * is not.
 *
 * A Like is not a record write. It is a call to the `swipe` server action,
 * which is the only thing in the system allowed to see both halves of a
 * mutual like (see src/actions/index.ts).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from 'deepspace'
import { Flame, Heart, Loader2, X } from 'lucide-react'
import { useToast } from '@/components/ui'
import { ActionError, callAction, type Profile, type Swipe, type SwipeResult } from '../../../lib/hottake'
import { useMyProfile, usePhotoUrl } from '../../../lib/use-hottake'

type Decision = 'like' | 'pass'

export default function Discover() {
  const navigate = useNavigate()
  const { error: toastError } = useToast()
  const photoUrl = usePhotoUrl()
  const { profile: myProfile, userId } = useMyProfile()

  const { records: profiles, status: profilesStatus } = useQuery<Profile>('profiles', {
    orderBy: 'createdAt',
    orderDir: 'desc',
  })
  // Only ever the caller's own rows — enforced by the schema, not by this filter.
  const { records: swipes, status: swipesStatus } = useQuery<Swipe>('swipes')

  const [pending, setPending] = useState(false)
  const [leaving, setLeaving] = useState<Decision | null>(null)
  const [match, setMatch] = useState<{ profile: Profile; channelId: string } | null>(null)
  // Targets we've decided on in this session. The swipe query catches up a
  // moment later; this keeps the stack from flashing the same face twice.
  const [justSwiped, setJustSwiped] = useState<string[]>([])

  const loading = profilesStatus === 'loading' || swipesStatus === 'loading'

  const stack = useMemo(() => {
    const seen = new Set<string>(justSwiped)
    for (const swipe of swipes) seen.add(swipe.data.targetId)
    return profiles.filter((p) => p.data.userId !== userId && !seen.has(p.data.userId))
  }, [profiles, swipes, justSwiped, userId])

  const current = stack[0]

  const decide = useCallback(
    async (direction: Decision) => {
      if (!current || pending) return
      const target = current.data
      setPending(true)
      setLeaving(direction)

      try {
        const result = await callAction<SwipeResult>('swipe', {
          targetId: target.userId,
          direction,
        })
        // Only drop the card once the server has accepted the swipe — a
        // rejected mutation must not silently consume a profile.
        setJustSwiped((prev) => [...prev, target.userId])
        if (result.matched && result.channelId) {
          setMatch({ profile: target, channelId: result.channelId })
        }
      } catch (err) {
        toastError(
          'That swipe did not land',
          err instanceof ActionError ? err.message : 'Try again.',
        )
      } finally {
        setLeaving(null)
        setPending(false)
      }
    },
    [current, pending, toastError],
  )

  // Desktop affordance: arrow keys mirror the buttons. Disabled while the
  // match modal is up so Enter/arrows don't swipe behind it.
  useEffect(() => {
    if (match) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'ArrowLeft') void decide('pass')
      if (event.key === 'ArrowRight') void decide('like')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [decide, match])

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Flame className="h-6 w-6 animate-pulse text-primary" aria-hidden />
        <span className="sr-only">Loading profiles</span>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col px-5 py-5">
      {current ? (
        <>
          <article
            key={current.recordId}
            data-testid="discovery-card"
            className={[
              'flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border border-border bg-card',
              'transition-all duration-200 ease-out',
              leaving === 'pass' ? '-translate-x-full -rotate-6 opacity-0' : '',
              leaving === 'like' ? 'translate-x-full rotate-6 opacity-0' : '',
            ].join(' ')}
          >
            <div className="relative min-h-0 flex-1 bg-muted">
              <img
                src={photoUrl(current.data.photoKey)}
                alt={`${current.data.displayName}'s photo`}
                className="h-full w-full object-cover"
              />
            </div>

            <div className="shrink-0 px-5 py-4">
              <h2 className="text-xl font-bold text-foreground" data-testid="card-name">
                {current.data.displayName}, {current.data.age}
              </h2>
              <p className="mt-3 flex gap-2 text-[15px] leading-snug text-card-foreground">
                <span aria-hidden="true">🔥</span>
                <span data-testid="card-hot-take">&ldquo;{current.data.hotTake}&rdquo;</span>
              </p>
            </div>
          </article>

          <div className="mt-5 flex shrink-0 items-center justify-center gap-8">
            <DecisionButton
              onClick={() => void decide('pass')}
              disabled={pending}
              label="Pass"
              testId="pass-button"
              className="border-border text-muted-foreground hover:border-foreground hover:text-foreground"
            >
              <X className="h-7 w-7" aria-hidden />
            </DecisionButton>

            <DecisionButton
              onClick={() => void decide('like')}
              disabled={pending}
              label="Like"
              testId="like-button"
              className="border-primary text-primary hover:bg-primary hover:text-primary-foreground"
            >
              {pending ? (
                <Loader2 className="h-7 w-7 animate-spin" aria-hidden />
              ) : (
                <Heart className="h-7 w-7" aria-hidden />
              )}
            </DecisionButton>
          </div>

          <p className="mt-3 shrink-0 text-center text-[11px] text-muted-foreground">
            Use ← and → if you have a keyboard.
          </p>
        </>
      ) : (
        <div
          data-testid="discovery-empty"
          className="flex h-full flex-col items-center justify-center px-6 text-center"
        >
          <span className="mb-4 text-3xl" aria-hidden="true">
            🔥
          </span>
          <h2 className="text-lg font-bold text-foreground">You&rsquo;re all caught up</h2>
          <p className="mt-2 max-w-xs text-sm text-muted-foreground">
            You&rsquo;ve judged everyone currently on HotTake. Check back when someone
            new enters the chaos.
          </p>
        </div>
      )}

      {match && myProfile && (
        <MatchModal
          them={match.profile}
          me={myProfile.data}
          photoUrl={photoUrl}
          onMessage={() => navigate(`/messages/${match.channelId}`)}
          onKeepSwiping={() => setMatch(null)}
        />
      )}
    </div>
  )
}

function DecisionButton({
  onClick,
  disabled,
  label,
  testId,
  className,
  children,
}: {
  onClick: () => void
  disabled: boolean
  label: string
  testId: string
  className: string
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      data-testid={testId}
      className={`flex h-16 w-16 items-center justify-center rounded-full border-2 bg-card transition-all hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  )
}

/**
 * Interrupts the stack on a mutual like. Dismissible — a match should never
 * trap someone who wants to keep going.
 */
function MatchModal({
  them,
  me,
  photoUrl,
  onMessage,
  onKeepSwiping,
}: {
  them: Profile
  me: Profile
  photoUrl: (key: string | undefined) => string | undefined
  onMessage: () => void
  onKeepSwiping: () => void
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="It's a match"
      data-testid="match-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 px-8 text-center backdrop-blur-sm"
    >
      <div className="flex w-full max-w-xs flex-col items-center">
        <span className="mb-5 text-4xl" aria-hidden="true">
          🔥
        </span>
        <h2 className="text-2xl font-bold tracking-tight text-foreground">It&rsquo;s a match</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          You and {them.displayName} both chose chaos.
        </p>

        <div className="my-7 flex items-center justify-center -space-x-4">
          {[me, them].map((person, index) => (
            <img
              key={index}
              src={photoUrl(person.photoKey)}
              alt=""
              className="h-20 w-20 rounded-full border-2 border-primary object-cover"
            />
          ))}
        </div>

        <button
          onClick={onMessage}
          data-testid="match-message-button"
          className="w-full rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        >
          Message {them.displayName}
        </button>
        <button
          onClick={onKeepSwiping}
          className="mt-3 w-full rounded-full px-6 py-3 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          Keep swiping
        </button>
      </div>
    </div>
  )
}
