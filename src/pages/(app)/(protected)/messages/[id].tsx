/**
 * One conversation, keyed by channel id (/messages/:id).
 *
 * Reading uses the SDK's `useMessages` hook verbatim — it subscribes over the
 * records WebSocket, so an incoming message renders without a refresh. Sending
 * does NOT use its `send()`: `messages` is `create: false` for members, and
 * writes go through the `sendMessage` action, which re-checks that the caller
 * is a participant of the match owning this channel.
 *
 * If the channel id in the URL isn't one of the caller's matches, `useMyMatches`
 * simply won't contain it — the DO never sent it — and we show "not found"
 * rather than an empty chat.
 *
 * Developer-mode conversations behave identically, except the reply is
 * generated: after the user sends, the client asks the `devReply` action to
 * produce the fixture's answer via Groq.
 */

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMessages, usePresence, useReadReceipts } from 'deepspace'
import type { Message } from 'deepspace'
import { ArrowLeft, Flame, Loader2, SendHorizontal } from 'lucide-react'
import { useToast } from '@/components/ui'
import PersonImage from '../../../../components/PersonImage'
import {
  ActionError,
  callAction,
  clockTime,
  isTruthy,
  otherParticipant,
} from '../../../../lib/hottake'
import { useMyMatches, useMyProfile, usePhotoUrl, useProfileDirectory } from '../../../../lib/use-hottake'

/**
 * The SDK's `Message` plus HotTake's `senderId` column, which distinguishes
 * "who wrote the row" (authorId, always the authenticated caller) from "who it
 * is from" (senderId, a fixture for developer-mode AI replies).
 */
type HotTakeMessage = Message & { senderId?: string }

export default function Conversation() {
  const { id: channelId } = useParams<{ id: string }>()
  const { userId } = useMyProfile()
  const { matches, loading: matchesLoading } = useMyMatches()
  const { directory } = useProfileDirectory()
  const photoUrl = usePhotoUrl()
  const { error: toastError } = useToast()
  const { isOnline } = usePresence()
  const { markAsRead } = useReadReceipts()

  const match = matches.find((m) => m.data.channelId === channelId)
  const themId = match && userId ? otherParticipant(match.data, userId) : undefined
  const them = themId ? directory.get(themId) : undefined
  const synthetic = isTruthy(match?.data.synthetic)

  const { messages, status } = useMessages(channelId)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [thinking, setThinking] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Follow the tail as messages arrive, including the other person's.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [messages.length, thinking])

  // Clear the unread badge while the conversation is actually open.
  useEffect(() => {
    if (channelId && status === 'ready') markAsRead(channelId)
  }, [channelId, status, messages.length, markAsRead])

  async function handleSend(event: FormEvent) {
    event.preventDefault()
    const content = draft.trim()
    if (!content || sending || !channelId) return

    setSending(true)
    try {
      await callAction('sendMessage', { channelId, content })
      setDraft('')

      // Developer-mode fixtures answer for themselves. Failure here is not a
      // failed send — the user's message is already delivered — so it surfaces
      // as a toast and nothing is rolled back.
      if (synthetic) {
        setThinking(true)
        try {
          await callAction('devReply', { channelId })
        } catch (err) {
          toastError(
            'The AI did not reply',
            err instanceof ActionError ? err.message : 'Try again.',
          )
        } finally {
          setThinking(false)
        }
      }
    } catch (err) {
      // Keep the draft in the box so a failed send never eats what they typed.
      toastError("Couldn't send that", err instanceof ActionError ? err.message : 'Try again.')
    } finally {
      setSending(false)
    }
  }

  if (matchesLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Flame className="h-6 w-6 animate-pulse text-primary" aria-hidden />
        <span className="sr-only">Loading conversation</span>
      </div>
    )
  }

  if (!match) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-8 text-center">
        <h1 className="text-base font-bold text-foreground">Conversation not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          You can only open conversations with people you&rsquo;ve matched.
        </p>
        <Link
          to="/matches"
          className="mt-6 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
        >
          Back to matches
        </Link>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
        <Link
          to="/matches"
          aria-label="Back to matches"
          className="text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </Link>
        <PersonImage
          person={them}
          photoUrl={photoUrl}
          className="h-9 w-9 rounded-full"
          initialClassName="text-sm"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">
            {them?.displayName ?? 'Someone'}
          </p>
          {synthetic ? (
            <p className="text-[11px] text-muted-foreground">AI fixture · developer mode</p>
          ) : (
            themId &&
            isOnline(themId) && (
              <p className="flex items-center gap-1.5 text-[11px] text-success">
                <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
                Online
              </p>
            )
          )}
        </div>
      </header>

      {/* The hot take stays pinned — it is the conversation starter, so it
          shouldn't scroll away the moment the chat gets going. */}
      {them && (
        <div className="shrink-0 border-b border-border bg-card px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-primary">
            {them.displayName}&rsquo;s hot take
          </p>
          <p className="mt-1 text-sm text-card-foreground">&ldquo;{them.hotTake}&rdquo;</p>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {status === 'loading' ? (
          <p className="text-center text-sm text-muted-foreground">Loading messages…</p>
        ) : messages.length === 0 ? (
          <p className="px-6 pt-10 text-center text-sm text-muted-foreground">
            You matched. Someone has to go first.
          </p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="message-list">
            {messages.map((message) => {
              // senderId, not authorId: a developer-mode AI reply is written by
              // the developer's account but is *from* the fixture. Rows written
              // before senderId existed fall back to authorId.
              const data = message.data as HotTakeMessage
              const mine = (data.senderId ?? data.authorId) === userId
              return (
                <li
                  key={message.recordId}
                  className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}
                >
                  <div
                    className={[
                      'max-w-[80%] px-4 py-2 text-[15px] leading-snug',
                      mine
                        ? 'rounded-[1.25rem] rounded-br-md bg-primary text-primary-foreground'
                        : 'rounded-[1.25rem] rounded-bl-md bg-card text-card-foreground',
                    ].join(' ')}
                  >
                    {message.data.content}
                  </div>
                  <span className="mt-1 px-1 text-[10px] text-muted-foreground">
                    {clockTime(message.createdAt)}
                  </span>
                </li>
              )
            })}
          </ul>
        )}

        {thinking && (
          <div className="mt-2 flex items-center gap-1.5 px-1" data-testid="ai-typing">
            <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.3s]" />
            <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.15s]" />
            <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground" />
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={handleSend}
        className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-3"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Say something controversial..."
          data-testid="message-input"
          className="min-w-0 flex-1 rounded-full border border-border bg-card px-4 py-2.5 text-[15px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary"
        />
        <button
          type="submit"
          disabled={!draft.trim() || sending}
          aria-label="Send"
          data-testid="message-send"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <SendHorizontal className="h-4 w-4" aria-hidden />
          )}
        </button>
      </form>
    </div>
  )
}
