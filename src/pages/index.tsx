/**
 * Landing page — a STATIC page.
 *
 * It lives at the top level of src/pages/ (not under (app)/), so it renders
 * with no DeepSpace providers: no auth session fetch, no records WebSocket.
 * Logged-out and crawler traffic costs nothing. "Start swiping" hands off to
 * /discover, which is where the gated app begins.
 */

import { Link } from 'react-router-dom'

const SAMPLE_TAKES = [
  'Breakfast food is better at night.',
  'Brunch is just overpriced breakfast.',
  'Concerts are better when you do not know the setlist.',
  'Iced coffee is better in winter.',
]

export default function Landing() {
  return (
    <div
      data-testid="static-landing"
      className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 py-16 text-center"
    >
      {/* A single warm bloom behind the fold — the only decoration on the page. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/3 h-[36rem] w-[36rem] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-[0.18] blur-[100px]"
        style={{ background: 'radial-gradient(circle, #ff5a3c 0%, transparent 70%)' }}
      />

      <div className="relative z-10 flex w-full max-w-lg flex-col items-center">
        <p className="mb-6 text-xs font-semibold uppercase tracking-[0.35em] text-primary">
          HotTake
        </p>

        <h1 className="mb-5 text-4xl font-bold leading-[1.1] tracking-tight text-foreground sm:text-5xl">
          Dating shouldn&rsquo;t start with &ldquo;hey.&rdquo;
        </h1>

        <p className="mb-10 max-w-sm text-base leading-relaxed text-muted-foreground">
          Match over the opinions you&rsquo;d argue about anyway. One photo, one hot
          take, and whoever wants to debate you.
        </p>

        <Link
          to="/discover"
          className="inline-flex items-center justify-center rounded-full bg-primary px-8 py-3.5 text-base font-semibold text-primary-foreground transition-transform hover:scale-[1.03] active:scale-[0.99]"
        >
          Start swiping
        </Link>

        <div className="mt-14 w-full">
          <p className="mb-4 text-xs uppercase tracking-widest text-muted-foreground">
            Currently up for debate
          </p>
          <ul className="flex flex-col gap-2.5">
            {SAMPLE_TAKES.map((take) => (
              <li
                key={take}
                className="rounded-2xl border border-border bg-card px-5 py-3 text-left text-sm text-card-foreground"
              >
                <span className="mr-2 select-none" aria-hidden="true">
                  🔥
                </span>
                {take}
              </li>
            ))}
          </ul>
        </div>

        <p className="mt-12 text-xs text-muted-foreground">
          18+. A prototype built on DeepSpace — please don&rsquo;t upload anything private.
        </p>
      </div>
    </div>
  )
}
