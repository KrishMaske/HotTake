/**
 * Landing page — a STATIC page.
 *
 * It lives at the top level of src/pages/ (not under (app)/), so it renders
 * with no DeepSpace providers: no auth session fetch, no records WebSocket.
 * Logged-out and crawler traffic costs nothing. "Start swiping" hands off to
 * /discover, which is where the gated app begins.
 *
 * The rotating take below is plain CSS-free React state — deliberately no
 * animation library for one effect on one page.
 */

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

const SAMPLE_TAKES = [
  'Breakfast food is better at night.',
  'Brunch is just overpriced breakfast.',
  'Cereal is a soup and I will not be taking questions.',
  'Iced coffee is better in winter.',
  'Voice notes are a hate crime.',
  'The book is usually not better.',
]

const STEPS = [
  { label: 'One photo', detail: 'No six-slide gallery. Just you.' },
  { label: 'One hot take', detail: 'The opinion you will actually defend.' },
  { label: 'One argument', detail: 'Match, then get straight into it.' },
]

export default function Landing() {
  const [index, setIndex] = useState(0)
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    // Fade out, swap, fade in — one interval, no library.
    const timer = setInterval(() => {
      setVisible(false)
      setTimeout(() => {
        setIndex((i) => (i + 1) % SAMPLE_TAKES.length)
        setVisible(true)
      }, 280)
    }, 2800)
    return () => clearInterval(timer)
  }, [])

  return (
    <div
      data-testid="static-landing"
      className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 py-16"
    >
      {/* A single warm bloom behind the fold — the only decoration on the page. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/3 h-[38rem] w-[38rem] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-[0.16] blur-[110px]"
        style={{ background: 'radial-gradient(circle, #ff5a3c 0%, transparent 70%)' }}
      />

      <div className="relative z-10 flex w-full max-w-md flex-col items-center text-center">
        <p className="mb-6 text-xs font-semibold uppercase tracking-[0.35em] text-primary">
          HotTake
        </p>

        <h1 className="mb-5 text-[2.5rem] font-bold leading-[1.08] tracking-tight text-foreground sm:text-5xl">
          Dating shouldn&rsquo;t start with &ldquo;hey.&rdquo;
        </h1>

        <p className="mb-9 max-w-sm text-base leading-relaxed text-muted-foreground">
          Match over the opinions you&rsquo;d argue about anyway.
        </p>

        {/* The product, in one card. */}
        <div className="mb-9 w-full rounded-[1.5rem] border border-border bg-card px-6 py-7">
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.25em] text-muted-foreground">
            Currently up for debate
          </p>
          <p
            className={`min-h-[3.5rem] text-lg font-medium leading-snug text-card-foreground transition-opacity duration-300 ${
              visible ? 'opacity-100' : 'opacity-0'
            }`}
          >
            <span className="mr-2 select-none" aria-hidden="true">
              🔥
            </span>
            {SAMPLE_TAKES[index]}
          </p>
        </div>

        <Link
          to="/discover"
          className="inline-flex w-full items-center justify-center rounded-full bg-primary px-8 py-4 text-base font-semibold text-primary-foreground transition-transform hover:scale-[1.02] active:scale-[0.99]"
        >
          Start swiping
        </Link>

        <ul className="mt-12 flex w-full flex-col gap-4 text-left">
          {STEPS.map((step, i) => (
            <li key={step.label} className="flex items-start gap-4">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-primary/40 text-xs font-bold text-primary">
                {i + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-foreground">{step.label}</span>
                <span className="block text-sm text-muted-foreground">{step.detail}</span>
              </span>
            </li>
          ))}
        </ul>

        <p className="mt-14 max-w-xs text-xs leading-relaxed text-muted-foreground">
          18+. A prototype built on DeepSpace — please don&rsquo;t upload anything private.
        </p>
      </div>
    </div>
  )
}
