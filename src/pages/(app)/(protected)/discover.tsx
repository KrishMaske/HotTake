/**
 * Discovery — the swipe stack.
 *
 * The eligible set comes from `useDiscoveryStack`, which subtracts the
 * caller's own swipes from everyone mutually compatible with them. That is
 * safe to do client-side precisely because `swipes` is `read: 'own'`: the
 * rows arriving here are only ever this user's, so "who have I already judged"
 * is answerable locally while "who liked me" is not.
 *
 * A Like is not a record write. It is a call to the `swipe` server action,
 * which is the only thing in the system allowed to see both halves of a mutual
 * like (see src/actions/index.ts).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Flame, Heart, RotateCcw, X } from 'lucide-react'
import { useToast } from '@/components/ui'
import PersonImage from '../../../components/PersonImage'
import {
  ActionError,
  callAction,
  type DisplayProfile,
  type RankedDisplayProfile,
  type SwipeResult,
} from '../../../lib/hottake'
import { useDiscoveryStack, useMyProfile, usePhotoUrl } from '../../../lib/use-hottake'
import { cn } from '../../../lib/utils'

type Decision = 'like' | 'pass'

/** Horizontal drag past this many pixels commits the swipe on release. */
const COMMIT_DISTANCE = 110

export default function Discover() {
  const navigate = useNavigate()
  const { error: toastError } = useToast()
  const photoUrl = usePhotoUrl()
  const { profile: myProfile, devMode } = useMyProfile()
  const { stack: eligible, loading } = useDiscoveryStack()

  const [pending, setPending] = useState(false)
  const [leaving, setLeaving] = useState<Decision | null>(null)
  const [match, setMatch] = useState<{ person: DisplayProfile; channelId: string } | null>(null)
  // Targets decided in this session. The swipe query catches up a moment
  // later; this keeps the stack from flashing the same face twice.
  const [justSwiped, setJustSwiped] = useState<string[]>([])
  const [drag, setDrag] = useState(0)
  const dragStart = useRef<number | null>(null)

  const stack = eligible.filter((p) => !justSwiped.includes(p.id))
  const current = stack[0]
  const next = stack[1]

  const decide = useCallback(
    async (direction: Decision, person: RankedDisplayProfile | undefined) => {
      if (!person || pending) return
      setPending(true)
      setLeaving(direction)
      setDrag(0)

      try {
        const result = await callAction<SwipeResult>('swipe', {
          targetId: person.id,
          direction,
        })
        // Only drop the card once the server has accepted the swipe — a
        // rejected mutation must not silently consume a profile.
        setJustSwiped((prev) => [...prev, person.id])
        if (result.matched && result.channelId) {
          setMatch({ person, channelId: result.channelId })
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
    [pending, toastError],
  )

  // Desktop affordance: arrow keys mirror the buttons. Disabled while the
  // match modal is up so arrows don't swipe behind it.
  useEffect(() => {
    if (match) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'ArrowLeft') void decide('pass', current)
      if (event.key === 'ArrowRight') void decide('like', current)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [decide, match, current])

  function onPointerDown(event: React.PointerEvent) {
    if (pending) return
    dragStart.current = event.clientX
    ;(event.target as HTMLElement).setPointerCapture?.(event.pointerId)
  }

  function onPointerMove(event: React.PointerEvent) {
    if (dragStart.current === null) return
    setDrag(event.clientX - dragStart.current)
  }

  function onPointerUp() {
    if (dragStart.current === null) return
    const distance = drag
    dragStart.current = null
    if (distance > COMMIT_DISTANCE) void decide('like', current)
    else if (distance < -COMMIT_DISTANCE) void decide('pass', current)
    else setDrag(0)
  }

  if (loading) return <DiscoverSkeleton />

  return (
    <div className="flex h-full flex-col px-5 pb-4 pt-5">
      {current ? (
        <>
          <div className="relative min-h-0 flex-1">
            {/* The next card, peeking, so the stack reads as a stack. */}
            {next && (
              <ProfileCard
                key={next.id}
                person={next}
                photoUrl={photoUrl}
                decorative
                className="absolute inset-0 scale-[0.96] opacity-60"
              />
            )}

            <ProfileCard
              key={current.id}
              person={current}
              photoUrl={photoUrl}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              className={cn(
                'absolute inset-0 cursor-grab touch-pan-y active:cursor-grabbing',
                leaving === 'pass' && '-translate-x-[130%] -rotate-12 opacity-0',
                leaving === 'like' && 'translate-x-[130%] rotate-12 opacity-0',
                leaving || dragStart.current === null ? 'transition-all duration-300 ease-out' : '',
              )}
              style={
                leaving
                  ? undefined
                  : { transform: `translateX(${drag}px) rotate(${drag * 0.05}deg)` }
              }
              stamp={drag > 60 ? 'like' : drag < -60 ? 'pass' : null}
            />
          </div>

          <div className="mt-5 flex shrink-0 items-center justify-center gap-10">
            <DecisionButton
              onClick={() => void decide('pass', current)}
              disabled={pending}
              label="Pass"
              testId="pass-button"
              className="border-border text-muted-foreground hover:border-foreground hover:text-foreground"
            >
              <X className="h-7 w-7" aria-hidden />
            </DecisionButton>

            <DecisionButton
              onClick={() => void decide('like', current)}
              disabled={pending}
              label="Like"
              testId="like-button"
              className="border-primary text-primary hover:bg-primary hover:text-primary-foreground"
            >
              <Heart className="h-7 w-7" aria-hidden />
            </DecisionButton>
          </div>

          <p className="mt-3 shrink-0 text-center text-[11px] text-muted-foreground">
            Drag the card, or use ← and →
          </p>
        </>
      ) : (
        <EmptyStack devMode={devMode} onOpenDev={() => navigate('/profile')} />
      )}

      {match && myProfile && (
        <MatchModal
          them={match.person}
          me={{
            id: myProfile.data.userId,
            displayName: myProfile.data.displayName,
            age: myProfile.data.age,
            hotTake: myProfile.data.hotTake,
            gender: myProfile.data.gender,
            photoKey: myProfile.data.photoKey,
            synthetic: false,
          }}
          photoUrl={photoUrl}
          onMessage={() => navigate(`/messages/${match.channelId}`)}
          onKeepSwiping={() => setMatch(null)}
        />
      )}
    </div>
  )
}

function ProfileCard({
  person,
  photoUrl,
  className,
  style,
  stamp,
  decorative = false,
  ...handlers
}: {
  person: RankedDisplayProfile
  photoUrl: (key: string | undefined) => string | undefined
  className?: string
  style?: React.CSSProperties
  stamp?: 'like' | 'pass' | null
  /** The card peeking behind the active one: visual only, and hidden from
   *  assistive tech and from queries that mean "the card being swiped". */
  decorative?: boolean
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <article
      data-testid={decorative ? undefined : 'discovery-card'}
      aria-hidden={decorative || undefined}
      className={cn(
        'flex select-none flex-col overflow-hidden rounded-[1.75rem] border border-border bg-card shadow-[0_2px_20px_rgba(0,0,0,0.45)]',
        className,
      )}
      style={style}
      {...handlers}
    >
      <div className="relative min-h-0 flex-1">
        <PersonImage
          person={person}
          photoUrl={photoUrl}
          className="pointer-events-none h-full w-full"
          initialClassName="text-7xl"
        />

        {/* Legibility scrim: the name sits on the photo, so it needs a floor. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/85 via-black/40 to-transparent"
        />

        {person.synthetic && (
          <span className="absolute left-4 top-4 rounded-full bg-black/60 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-white/90 backdrop-blur">
            Dev fixture
          </span>
        )}

        {stamp && (
          <span
            className={cn(
              'absolute top-6 rounded-xl border-[3px] px-4 py-1.5 text-xl font-black uppercase tracking-widest',
              stamp === 'like'
                ? 'left-5 -rotate-12 border-primary text-primary'
                : 'right-5 rotate-12 border-muted-foreground text-muted-foreground',
            )}
          >
            {stamp === 'like' ? "I'd debate that" : 'Pass'}
          </span>
        )}

        <div className="pointer-events-none absolute inset-x-0 bottom-0 px-5 pb-4">
          <h2
            className="text-2xl font-bold text-white drop-shadow"
            data-testid={decorative ? undefined : 'card-name'}
          >
            {person.displayName}, {person.age}
          </h2>
          {/* Why the ranker put this card here. Ordering is otherwise
              invisible, and an unexplained "algorithm" is just noise. */}
          {person.rankReason && (
            <p
              className="mt-1 text-xs font-medium text-white/75 drop-shadow"
              data-testid={decorative ? undefined : 'card-reason'}
            >
              {person.rankReason}
            </p>
          )}
        </div>
      </div>

      <div className="shrink-0 px-5 py-4">
        <p className="flex gap-2.5 text-[15px] leading-snug text-card-foreground">
          <span aria-hidden="true">🔥</span>
          <span data-testid={decorative ? undefined : 'card-hot-take'}>
            &ldquo;{person.hotTake}&rdquo;
          </span>
        </p>
      </div>
    </article>
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
      className={cn(
        'flex h-16 w-16 items-center justify-center rounded-full border-2 bg-card transition-all hover:scale-110 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
    >
      {children}
    </button>
  )
}

function EmptyStack({ devMode, onOpenDev }: { devMode: boolean; onOpenDev: () => void }) {
  return (
    <div
      data-testid="discovery-empty"
      className="flex h-full flex-col items-center justify-center px-6 text-center"
    >
      <span className="mb-4 text-3xl" aria-hidden="true">
        🔥
      </span>
      <h2 className="text-lg font-bold text-foreground">You&rsquo;re all caught up</h2>
      <p className="mt-2 max-w-xs text-sm text-muted-foreground">
        You&rsquo;ve judged everyone currently on HotTake. Check back when someone new
        enters the chaos.
      </p>
      {!devMode && (
        <button
          onClick={onOpenDev}
          className="mt-7 inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-xs font-medium text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          Need people to test with? Turn on developer mode
        </button>
      )}
    </div>
  )
}

function DiscoverSkeleton() {
  return (
    <div className="flex h-full flex-col px-5 pb-4 pt-5">
      <div className="min-h-0 flex-1 animate-pulse rounded-[1.75rem] border border-border bg-card" />
      <div className="mt-5 flex shrink-0 items-center justify-center gap-10">
        <div className="h-16 w-16 animate-pulse rounded-full bg-card" />
        <div className="h-16 w-16 animate-pulse rounded-full bg-card" />
      </div>
      <span className="sr-only">Loading profiles</span>
    </div>
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
  them: DisplayProfile
  me: DisplayProfile
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 px-8 text-center backdrop-blur-md"
    >
      <div className="flex w-full max-w-xs flex-col items-center">
        <Flame className="mb-4 h-10 w-10 animate-bounce text-primary" aria-hidden />
        <h2 className="text-3xl font-black tracking-tight text-foreground">It&rsquo;s a match</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          You and {them.displayName} both chose chaos.
        </p>

        <div className="my-8 flex items-center justify-center -space-x-5">
          {[me, them].map((person, index) => (
            <PersonImage
              key={index}
              person={person}
              photoUrl={photoUrl}
              className={cn(
                'h-24 w-24 rounded-full border-[3px] border-primary',
                index === 1 && 'rotate-6',
              )}
              initialClassName="text-3xl"
            />
          ))}
        </div>

        <button
          onClick={onMessage}
          data-testid="match-message-button"
          className="w-full rounded-full bg-primary px-6 py-3.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        >
          Message {them.displayName}
        </button>
        <button
          onClick={onKeepSwiping}
          className="mt-2 w-full rounded-full px-6 py-3 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          Keep swiping
        </button>
      </div>
    </div>
  )
}
