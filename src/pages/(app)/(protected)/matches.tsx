/**
 * Matches list.
 *
 * Neither query here carries a `where` clause scoping it to the caller, and
 * that is the point: `matches` and `messages` are both `read: 'collaborator'`,
 * so the Durable Object has already dropped every row this user isn't a
 * participant in before it reached the socket. Filtering here would be
 * decoration.
 */

import { Link } from 'react-router-dom'
import { useQuery, useReadReceipts } from 'deepspace'
import type { Message } from 'deepspace'
import { Flame } from 'lucide-react'
import PersonImage from '../../../components/PersonImage'
import { isTruthy, otherParticipant, relativeTime } from '../../../lib/hottake'
import { useMyMatches, useMyProfile, usePhotoUrl, useProfileDirectory } from '../../../lib/use-hottake'

export default function Matches() {
  const { userId, devMode } = useMyProfile()
  const { matches, loading } = useMyMatches()
  const { directory } = useProfileDirectory()
  const photoUrl = usePhotoUrl()
  const { getUnreadCount } = useReadReceipts()

  const { records: messages } = useQuery<Message>('messages', {
    orderBy: 'createdAt',
    orderDir: 'desc',
  })

  // Messages arrive newest-first, so the first hit per channel is the latest.
  const latestByChannel = new Map<string, (typeof messages)[number]>()
  for (const message of messages) {
    if (!latestByChannel.has(message.data.channelId)) {
      latestByChannel.set(message.data.channelId, message)
    }
  }

  if (loading) return <MatchesSkeleton />

  return (
    <div className="px-5 py-6">
      <div className="mb-5 flex items-baseline justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Matches</h1>
        {matches.length > 0 && (
          <span className="text-xs text-muted-foreground">{matches.length} total</span>
        )}
      </div>

      {matches.length === 0 ? (
        <div
          data-testid="matches-empty"
          className="flex flex-col items-center px-6 py-16 text-center"
        >
          <span className="mb-4 text-3xl" aria-hidden="true">
            💤
          </span>
          <h2 className="text-base font-bold text-foreground">No matches yet</h2>
          <p className="mt-2 max-w-xs text-sm text-muted-foreground">
            Apparently nobody can handle your opinions.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2.5" data-testid="matches-list">
          {matches.map((match) => {
            const themId = userId ? otherParticipant(match.data, userId) : undefined
            const them = themId ? directory.get(themId) : undefined
            const latest = latestByChannel.get(match.data.channelId)
            const unread = getUnreadCount(match.data.channelId, messages)
            const synthetic = isTruthy(match.data.synthetic)

            return (
              <li key={match.recordId}>
                <Link
                  to={`/messages/${match.data.channelId}`}
                  className="flex items-center gap-4 rounded-2xl border border-border bg-card p-3 transition-colors hover:border-primary/60"
                >
                  <div className="relative shrink-0">
                    <PersonImage
                      person={them}
                      photoUrl={photoUrl}
                      className="h-14 w-14 rounded-full"
                      initialClassName="text-lg"
                    />
                    {unread > 0 && (
                      <span
                        data-testid="unread-badge"
                        className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground"
                      >
                        {unread > 9 ? '9+' : unread}
                      </span>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate font-semibold text-foreground">
                          {/* A match whose profile hasn't synced yet is still a
                              valid match — show the row rather than hiding it. */}
                          {them?.displayName ?? 'Someone'}
                        </span>
                        {devMode && synthetic && (
                          <span className="shrink-0 rounded-full bg-secondary px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                            AI
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {relativeTime(latest?.createdAt ?? match.createdAt)}
                      </span>
                    </div>
                    <p
                      className={`mt-0.5 truncate text-sm ${
                        unread > 0 ? 'font-medium text-foreground' : 'text-muted-foreground'
                      }`}
                    >
                      {latest ? (
                        latest.data.content
                      ) : (
                        <>
                          <span aria-hidden="true">🔥 </span>
                          {them?.hotTake ?? 'Say something controversial.'}
                        </>
                      )}
                    </p>
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function MatchesSkeleton() {
  return (
    <div className="px-5 py-6">
      <h1 className="mb-5 text-2xl font-bold tracking-tight text-foreground">Matches</h1>
      <ul className="flex flex-col gap-2.5">
        {[0, 1, 2].map((i) => (
          <li
            key={i}
            className="flex items-center gap-4 rounded-2xl border border-border bg-card p-3"
          >
            <div className="h-14 w-14 shrink-0 animate-pulse rounded-full bg-muted" />
            <div className="flex-1 space-y-2">
              <div className="h-3.5 w-24 animate-pulse rounded bg-muted" />
              <div className="h-3 w-40 animate-pulse rounded bg-muted" />
            </div>
          </li>
        ))}
      </ul>
      <span className="sr-only">
        <Flame aria-hidden /> Loading matches
      </span>
    </div>
  )
}
