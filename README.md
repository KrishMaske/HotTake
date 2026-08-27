# HotTake

**Dating shouldn't start with "hey."**

A realtime dating app where every profile is one photo and one opinion worth
arguing about. Browse profiles, like or pass, form mutual matches, and message
your matches in realtime.

**Live:** https://hottake.app.space
**Repository:** https://github.com/KrishMaske/HotTake

Built on [DeepSpace](https://deep.space) using authentication, realtime
records, role-based permissions, R2 file storage, native messaging, presence,
read receipts, and server actions.

> Built as an evaluation exercise in an 8-hour timebox. It is a working
> prototype, not a production dating platform. Open issues are documented
> honestly in [Known issues](#known-issues) and [Not built](#not-built)
> rather than hidden.

---

## Submission summary

| | |
| --- | --- |
| **What I built** | A complete dating loop — profile → discovery → mutual like → match → realtime DM — plus a developer mode that makes the multi-user path testable by one person. |
| **Capabilities used** | Auth, realtime records, RBAC permissions, R2 storage, native messaging, presence, read receipts, server actions — 8 total. |
| **Main tradeoff** | Matching runs in a **server action** rather than the client, because the permission rule that hides "who liked you" is the same rule that makes client-side match detection impossible. I chose to keep the permission boundary real and move the logic server-side. |
| **What the agent did** | Wrote the implementation under my direction. See [How this was built](#how-this-was-built). |
| **What I verified** | Every bug in this app's history was found by me using the deployed app, not by the test suite. See [What I verified myself](#what-i-verified-myself). |

---

## The product loop

```
sign in → create profile → discover → like / pass → mutual like → match → message
```

That is the whole app. Everything below exists to make that path correct
rather than to add a second one.

Discovery respects gender and preferences: you see someone only when their
gender is in your `interestedIn` **and** yours is in theirs. That rule is
applied in the client stack *and* re-checked inside the `swipe` action, so it
survives a hand-rolled request.

---

## The core design decision

The product requires that **you never learn who liked you before you match**.
That makes `swipes` a `read: 'own'` collection — a user's client only ever
receives their own swipe rows.

Which means the client *cannot* detect a match. The query it would need
("did Maya already like me?") is precisely the query the permission rule
forbids. **Enforcing the rule and detecting the match are the same problem.**

There were two ways out:

1. Relax `swipes` to readable and filter in the client. Fast, and wrong — the
   data is on the wire, so the privacy claim becomes a UI convention.
2. Move matching into a server action that can see both sides.

I took the second. Matching runs in `src/actions/index.ts`, whose `tools` API
bypasses per-record RBAC. The `swipe` action:

1. refuses self-swipes and unknown targets,
2. writes the swipe as the **verified JWT subject** — `swiperId` is
   `userBound`, so the record room overwrites whatever the client sent,
3. re-checks mutual gender compatibility server-side,
4. checks for the reciprocal like with its wider view,
5. creates the DM channel and exactly one match,
6. returns `{ matched: true | false }` — and nothing else.

The client learns *that* it matched, never *who liked it first*. The permission
rule stays a real boundary instead of a hidden button.

### Concurrency without transactions

`uniqueOn` does the work a transaction would otherwise do:

- `['swiperId', 'targetId']` on swipes makes double-taps idempotent.
- `['pairKey']` on matches (the sorted id pair) means two simultaneous likes
  still produce exactly one match. The action handles losing that race by
  re-reading the winner rather than surfacing a duplicate-key error.
- `['ownerId', 'slot']` on dev fixtures makes seeding convergent — see
  [Developer mode](#developer-mode).

---

## Permissions

Set in `src/schemas/hottake-schemas.ts`. Every rule is enforced server-side in
the Durable Object, which drops unreadable rows *before* they reach the
WebSocket.

| Collection | member read | member write |
| --- | --- | --- |
| `profiles` | `true` — this is discovery | `create`, `update: 'own'` |
| `dev-profiles` | `'own'` — your fixtures are yours alone | none; the `devSeed` action is the only writer |
| `swipes` | `'own'` — nobody sees who liked them | none; the `swipe` action is the only writer |
| `matches` | `'collaborator'` — participants only | none; created by the `swipe` action |
| `channels` | `'collaborator'` | none |
| `messages` | `'collaborator'` | none; the `sendMessage` action is the only writer |
| `read-receipts` | `'own'` — your read state is not public | direct; `userId` is `userBound` |

Identity is never taken from client input. `userId`, `swiperId`, `ownerId`, and
`authorId` are all `userBound: true`, which the record room stamps from the
verified JWT on create.

### The SDK messaging schemas are deliberately overridden

`CHANNELS_SCHEMA` and `MESSAGES_SCHEMA` ship with `member: { read: true }`.
That is a sensible default for team chat, where everyone belongs to the same
workspace — and wrong for private DMs between strangers, because any signed-in
user could read every message in the app.

HotTake keeps the SDK's columns (so `useMessages` works verbatim) and replaces
the permission block with participant-scoped access, adding a `participants`
JSON column wired up via `collaboratorsField`. Writes go through
`sendMessage`, which copies `participants` from the match row instead of
trusting the request — so a client cannot post itself into a stranger's
conversation by stamping its own array.

The SDK's `READ_RECEIPTS_SCHEMA` gets the same treatment: its default publishes
everyone's read state, tightened here to `read: 'own'`.

This is directly tested: see *"a third member cannot reach a conversation
between two others"* in `tests/hottake.spec.ts`, which uses a real signed-in
third account holding a real channel id — exactly the case client-side hiding
gets wrong.

---

## Discovery ranking

`src/lib/ranking.ts` scores candidates rather than ordering by recency:

1. **Shared hot-take topics** dominate — the premise of the app is that the
   interesting person is the one you would argue with. Crude stemming and a
   short stopword list make "concerts" and "concert" line up.
2. **Age proximity** and **profile freshness** break ties.

Each card shows *why* it is being ranked ("Woman · Same age bracket").

One signal is deliberately absent. Boosting people who already liked you is
the obvious move and most dating apps do it — but position is information, and
that boost would leak exactly what `swipes: read: 'own'` exists to protect.
Ranking uses only facts both parties published.

The module is pure and dependency-free, so it unit-tests directly and could
move server-side unchanged when discovery outgrows the client.

---

## Developer mode

Testing a dating app needs two people. Developer mode removes that
requirement: flip the switch on `/profile` and HotTake generates 50 fixture
people whose replies come from an LLM, so the whole loop is exercisable
without a second human and a second browser.

The interesting part is that it is scoped by the **permission layer**, not by
a client-side filter. Fixtures live in `dev-profiles`, which is `read: 'own'`,
so the Durable Object only ever ships a developer their own — another user
cannot see them even holding an id, and the `swipe` action re-checks `ownerId`
before acting. That is why they are a separate collection rather than a
`synthetic: true` flag on `profiles`, where one missing `.filter()` would leak
fifty fake people into a real user's stack.

Turning it off hides every synthetic match and their conversations; the switch
does not delete anything. **Clear** does.

Four implementation notes worth knowing:

- **Fixtures do not pre-match.** They decide whether they like you back
  (deterministically, by id), and a match forms only when you swipe right on
  one that does — the same code path a real mutual like takes. An earlier
  version pre-created matches, which meant the feature under test was being
  bypassed by the thing testing it.
- **Seeding is batched and convergent.** Each `devSeed` call creates ten
  fixtures and reports progress; the client loops until done. Fifty record
  writes in one worker invocation would sit uncomfortably close to the
  subrequest ceiling. Seeding picks work from *missing `slot` values* rather
  than counting rows — counting is a read-then-write race, and two overlapping
  loops produced "95 / 50".
- **`messages` carries both `authorId` and `senderId`.** The SDK's `authorId`
  is `userBound` — always the authenticated account that wrote the row, which
  for an AI reply is the developer. `senderId` is who the message is *from*,
  and is what the UI renders. Collapsing them would either misattribute the
  row or require trusting a client-supplied author.
- **Fixtures have no photograph.** They render a deterministic gradient from a
  stored `hue`, because inventing faces for people who do not exist is the
  wrong default.

---

## Platform capabilities used

| Capability | Where |
| --- | --- |
| **Authentication** | `AuthGate` + `AuthOverlay`; public landing, gated app under `(app)/(protected)/` |
| **Realtime records** | `useQuery` / `useMutations` over the RecordRoom socket — matches and messages arrive with no refresh |
| **Permissions (RBAC)** | Per-collection rules above, incl. `'own'`, `'collaborator'`, `uniqueOn`, `userBound` |
| **File storage (R2)** | `useR2Files({ scope: 'app' })` for profile photos |
| **Messaging** | SDK `MESSAGES_SCHEMA` / `CHANNELS_SCHEMA` + `useMessages`, permissions tightened |
| **Server actions** | `saveProfile`, `swipe`, `sendMessage`, plus the developer-mode four |
| **Presence** | `usePresence().isOnline` drives the online dot in the conversation header |
| **Read receipts** | `useReadReceipts` for unread badges, with the SDK's permissive default tightened to `read: 'own'` |

The bundled `deepspace add messaging` feature was **not** used: it ships a
Slack-style multi-channel UI (sidebar, threads, invitations, member management)
that doesn't fit a two-person dating DM. The underlying schemas and hooks are
used directly instead — using the primitive rather than the packaged feature.

---

## How this was built

The brief allowed a coding agent and asked what it did versus what I did. The
honest split:

**I owned the product and the architecture.** I wrote the PRD, set the scope
and the P0/P1 split, and made the calls that shaped the codebase:

- that a match must require a right-swipe from **both** sides — the agent's
  first developer-mode implementation pre-created matches, which quietly
  bypassed the very code path the feature existed to test. I rejected it.
- that discovery had to account for **gender and preferences**, which the
  original PRD had listed as a non-goal and which I added once the core loop
  worked.
- that the matching engine needed to be more than recency ordering, which
  became `ranking.ts`.
- that the agent **stops short of deploying**. After an early deploy went out
  mid-session, I took deploys back and ran every one myself, so I always knew
  what was actually live.

**The agent wrote the implementation** under that direction — schemas,
actions, hooks, components, and the test suite — and was useful for the parts
where the SDK's behaviour had to be read carefully: the `authorId`/`senderId`
split, the `collaboratorsField` wiring, the `uniqueOn` concurrency work.

**I found the bugs.** This matters more than the line count, because the test
suite was green while the app was visibly broken. Every one of these came from
me using the deployed app and reporting what I saw:

| What I saw | What it actually was |
| --- | --- |
| Matches appearing in the tab with nobody swiping | `devSeed` pre-created matches instead of letting the swipe path form them |
| The fixture panel reading "95 / 50" | Read-then-write race: seeding counted rows, so two overlapping loops wrote the same batch |
| 11 dev matches surviving every Clear and reseed | `devReset` only deleted a match if its fixture still existed, so deleting a fixture orphaned its match permanently |
| Sign-in landing on a 404 | `oauth-complete` hardcoded a redirect to `/home`, a route that no longer existed |
| People in my deck I hadn't asked to see | Fixtures weren't regenerated when preferences changed |
| "That swipe didn't land," card stuck | A stale card stack was being reported as a failed swipe |

The orphaned-match bug is the one I would point at. The agent wrote the guard
`if (!participants.some((id) => fixtureIds.has(id))) continue`, which looks
defensive and reads fine in review. It was unreachable-state logic that could
only be caught by running the thing — and the fix also had to sweep the bad
state that already existed on live accounts, because a correct `devReset`
alone would never catch up.

### What I verified myself

- Ran the suite against **production**, not just locally — the deployed app
  behind a real edge is the only environment that counts.
- Drove the two-user path by hand with separate accounts: profile → discover →
  mutual like → match → realtime message.
- Checked the permission boundaries with a real third signed-in account
  holding a real channel id, rather than trusting the client-side hiding.
- Watched the browser console during live use, which is how I caught a burst
  of transient 403s that no test reported.
- Ran every deploy myself and confirmed each release against the live URL.

---

## Running it locally

```bash
npm install
npx deepspace auth login      # opens browser OAuth
npx deepspace dev start       # http://localhost:5173
```

Deploy:

```bash
npx deepspace deploy
```

Auth, storage, and the database are platform services reached through the
app's own worker — nothing to configure.

**Node 22.15+ is required** (the SDK refuses older lines).

### Developer-mode AI replies

Fixture replies call an LLM provider, which is not a platform integration, so
the app brings its own key:

```bash
npx deepspace secrets set GROQ_API_KEY=your-key-here
npx deepspace secrets pull        # refresh the local .dev.vars cache
npx deepspace deploy              # secrets take effect at deploy time
```

`GROQ_MODEL` optionally overrides the default. Without the key everything else
works and `devReply` fails closed with a message saying what to set.

Secrets belong in the secret store, never in `.env` or a committed file — the
worker does not read `.env` at all, and `.env` / `.dev.vars` are gitignored.

### Tests

```bash
npm run test:unit                                # 35 unit tests
npx deepspace test run all                       # full suite against local dev
DEEPSPACE_BASE_URL=https://hottake.app.space \
  npx playwright test --config tests/playwright.config.ts   # against production
```

The multi-user specs need at least three test accounts:

```bash
npx deepspace test accounts create --email alex-hottake@deepspace.test  --password 'TestPass123!' --name Alex
npx deepspace test accounts create --email maya@deepspace.test          --password 'TestPass123!' --name Maya
npx deepspace test accounts create --email casey-hottake@deepspace.test --password 'TestPass123!' --name Casey
```

To give an environment some profiles to swipe on:

```bash
DEEPSPACE_SEED=1 DEEPSPACE_BASE_URL=https://hottake.app.space \
  npx playwright test --config tests/playwright.config.ts tests/seed-demo.spec.ts
```

Local record data lives in `.wrangler/`. Deleting that directory resets the
local database without touching production.

**Test coverage:** 35 unit tests (matching predicates and ranking) and 22
end-to-end tests across five specs — the important path, permission
boundaries, developer-mode scoping, seeding concurrency, and the OAuth return
path against open redirects. The suite runs with `workers: 1`, because the
specs drive a shared pool of live accounts and parallel workers made results
depend on ordering.

---

## Known issues

Open at the end of the timebox. Listed because they are real, not because they
are comfortable.

**One commit is not deployed.** Production runs the commit before the
seed-retry hardening — nothing is broken without it, but that fix is not live.
The `space` remote sits one commit behind `master`, which is how you can tell.

**A transient failure mid-seed abandons the deck.** Two 403s appeared in the
console in the minute after a deploy, while the edge was still propagating.
They were not reproducible afterwards — five clean runs — so the diagnosis is
edge propagation, not a systemic fault. But a single blip currently abandons a
half-built deck and reports "Seeding failed". The last commit makes each batch
retry with backoff, which is safe because batches are idempotent. It is
committed and **not deployed**.

**Existing accounts may hold orphaned dev matches.** Accounts that used
developer mode before the `devReset` fix can still hold synthetic matches that
Clear could not reach. `devSeed` now sweeps orphans it finds, so opening
**Profile → Generate people** once heals the state — but it does not heal on
its own.

**Local dev is flaky when two servers run.** `deepspace test run` and a
standalone `deepspace dev start` fight over port 5173, because `test run`
rewrites `.dev.vars` and restarts vite. Use one or the other;
`npx deepspace dev kill --all` clears stragglers.

**Profile photos are world-readable.** Uploads use R2 scope `'app'`, whose URLs
carry no auth token, because a photo has to load in *another user's* browser as
a plain `<img src>`. Scope `'self'` requires the owner's `Authorization` header
and cannot be embedded across accounts. So a photo URL, if leaked, is viewable
by anyone holding it. A production build would want signed, expiring URLs.

**Discovery does not scale.** The eligible stack is computed client-side from
"all profiles" minus "my swipes". Correct and cheap for a prototype; it would
fall over at thousands of users. Real discovery needs server-side pagination
and exclusion — `ranking.ts` was written pure so it can move server-side
unchanged. Matches and profile lookups are unpaginated for the same reason.

**Presence is coarse.** `usePresence` reports online from a 60-second
heartbeat, so the dot can lag reality by up to a minute.

**Developer-mode AI replies are unmetered.** `devReply` is gated to fixtures
the caller owns, but there is no rate limit, so a determined developer can
burn their own provider quota. Fine for a prototype, not for anything shared.

**Gender is a three-option enum.** Enough to make the matching rule real, and
plainly not enough for a product people would actually use.

**Photo upload has no crop or compression.** Files are capped client-side at
5 MB and the aspect ratio is whatever the user uploaded.

### Not built

Deliberately out of scope for an 8-hour prototype, and listed because a real
dating app cannot ship without them: age verification beyond a self-reported
number, blocking, reporting, content and image moderation, harassment
prevention, rate limiting, account deletion, data retention controls, and
location privacy.

### What I would do next

1. Deploy the seed-retry commit and re-verify the seed loop under induced
   failure.
2. Move discovery server-side — paginated, with exclusion and ranking in the
   worker. This is the only change the current architecture actually forces.
3. Signed, expiring photo URLs.
4. Rate-limit `devReply`, and block/report as the first real safety
   primitives.

---

## Project layout

```
src/
  actions/index.ts              saveProfile, swipe, sendMessage,
                                setDevMode, devSeed, devReset, devReply
  schemas/hottake-schemas.ts    collections + the permission model
  schemas.ts                    schema registration
  lib/hottake.ts                action client, shared types
  lib/use-hottake.ts            profile/match/photo/directory hooks
  lib/ranking.ts                discovery scoring (pure, unit-tested)
  lib/dev-personas.ts           fixture generator (deterministic, dependency-free)
  components/ProfileForm.tsx    editor shared by onboarding and /profile
  components/DevPanel.tsx       developer-mode switch, seeding, clear
  components/Navigation.tsx     top bar + bottom tab bar with unread badges
  pages/
    index.tsx                   static landing (no auth, no socket)
    (app)/_layout.tsx           auth + records providers, mobile column
    (app)/(protected)/          gated: onboarding, discover, matches,
                                messages/[id], profile
tests/
  hottake.spec.ts               the important path + permission boundaries
  dev-mode.spec.ts              fixtures, their scoping, seeding concurrency
  api.spec.ts                   OAuth return path, open-redirect cases
  smoke.spec.ts                 route and render checks
  collab.spec.ts                realtime multi-client check
  seed-demo.spec.ts             demo data utility (excluded from the suite)
  ../src/lib/hottake.test.ts    unit tests for the matching predicates
  ../src/lib/ranking.test.ts    unit tests for discovery scoring
```
