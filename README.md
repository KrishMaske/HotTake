# HotTake

**Dating shouldn't start with "hey."**

A realtime dating prototype where every profile is one photo and one opinion
worth arguing about. Browse profiles, like or pass, form mutual matches, and
message your matches in realtime.

Ships with a **developer mode**: 50 fixture people only you can see, some of
whom already match you, whose replies come from Groq — so the whole loop is
testable without a second human and a second browser.

**Live:** https://hottake.app.space

Built on [DeepSpace](https://deep.space) using authentication, realtime
records, role-based permissions, R2 file storage, native messaging, presence,
and server actions.

> Built as an evaluation exercise in an 8-hour timebox. It is not a production
> dating platform — see [Not built](#not-built).

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

The one exception is developer-mode AI replies, which call Groq (not a
platform integration, so the app brings its own key):

```bash
npx deepspace secrets set GROQ_API_KEY=your-key-here
npx deepspace secrets pull        # refresh the local .dev.vars cache
npx deepspace deploy
```

Optionally `GROQ_MODEL` overrides the default (`llama-3.3-70b-versatile`).
Without the key everything else works and `devReply` fails closed with a
message saying what to set. Secrets belong in the store, never in `.env` or a
committed file — the worker does not read `.env` at all.

**Node 22.15+ is required** (the SDK refuses older lines).

### Tests

```bash
npx deepspace test run all                       # full suite against local dev
DEEPSPACE_BASE_URL=https://hottake.app.space \
  npx playwright test --config tests/playwright.config.ts   # against production
```

The multi-user specs need at least three test accounts:

```bash
npx deepspace test accounts create --email alex-hottake@deepspace.test --password 'TestPass123!' --name Alex
npx deepspace test accounts create --email maya@deepspace.test         --password 'TestPass123!' --name Maya
npx deepspace test accounts create --email casey-hottake@deepspace.test --password 'TestPass123!' --name Casey
```

To give an environment some profiles to swipe on:

```bash
DEEPSPACE_BASE_URL=https://hottake.app.space \
  npx playwright test --config tests/playwright.config.ts tests/seed-demo.spec.ts
```

Local record data lives in `.wrangler/`. Deleting that directory resets the
local database without touching production.

---

## The one interesting design decision

The product requires that **you never learn who liked you before you match**.
That makes `swipes` a `read: 'own'` collection — a user's client only ever
receives their own swipe rows.

Which means the client *cannot* detect a match. The query it would need
("did Maya already like me?") is precisely the query the permission rule
forbids. Enforcing the rule and detecting the match are the same problem.

So matching runs in a **server action** (`src/actions/index.ts`), whose `tools`
API bypasses per-record RBAC. The `swipe` action:

1. refuses self-swipes and unknown targets,
2. writes the swipe as the **verified JWT subject** — `swiperId` is
   `userBound`, so the record room overwrites whatever the client sent,
3. checks for the reciprocal like with its wider view,
4. creates the DM channel and exactly one match,
5. returns `{ matched: true | false }` — and nothing else.

The client learns *that* it matched, never *who liked it first*. The permission
rule stays a real boundary instead of a hidden button.

`uniqueOn` does the concurrency work that would otherwise need a transaction:
`['swiperId', 'targetId']` makes swipes idempotent under double-taps, and
`['pairKey']` on matches (the sorted id pair) means two simultaneous likes
still produce exactly one match. The action handles losing that race by
re-reading the winner rather than surfacing a duplicate-key error.

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

Identity is never taken from client input. `userId`, `swiperId`, and `authorId`
are all `userBound: true`, which the record room stamps from the verified JWT
on create.

### The SDK messaging schemas are deliberately overridden

`CHANNELS_SCHEMA` and `MESSAGES_SCHEMA` ship with `member: { read: true }`.
That is a sensible default for team chat, where everyone belongs to the same
room — and wrong for private DMs between strangers, because any signed-in user
could read every message in the app.

HotTake keeps the SDK's columns (so `useMessages` works verbatim) and replaces
the permission block with participant-scoped access, adding a `participants`
JSON column wired up via `collaboratorsField`. Writes go through
`sendMessage`, which copies `participants` from the match row instead of
trusting the request — so a client cannot post itself into a stranger's
conversation by stamping its own array.

This is directly tested: see *"a third member cannot reach a conversation
between two others"* in `tests/hottake.spec.ts`, which uses a real signed-in
third account holding a real channel id.

---

## Developer mode

Testing a dating app needs two people. Developer mode removes that
requirement: flip the switch on `/profile` and HotTake generates 50 fixture
people, pre-matches a random 6–12 of them, and answers their messages with
Groq.

The interesting part is that it is scoped by the **permission layer**, not by
a client-side filter. Fixtures live in `dev-profiles`, which is `read: 'own'`,
so the Durable Object only ever ships a developer their own — another user
cannot see them even holding an id, and the `swipe` action re-checks `ownerId`
before acting. That is why they are a separate collection rather than a
`synthetic: true` flag on `profiles`, where one missing `.filter()` would leak
fifty fake people into a real user's stack.

Turning it off hides every synthetic match and their conversations; the switch
does not delete anything. **Clear** does.

Two implementation notes worth knowing:

- **Seeding is batched.** Each `devSeed` call creates ten fixtures and reports
  progress; the client loops until done. Fifty record writes in one worker
  invocation would sit uncomfortably close to the subrequest ceiling.
- **`messages` carries both `authorId` and `senderId`.** The SDK's `authorId`
  is `userBound` — always the authenticated account that wrote the row, which
  for an AI reply is the developer. `senderId` is who the message is *from*,
  and is what the UI renders. Collapsing them would either misattribute the
  row or require trusting a client-supplied author.

Fixtures have no photograph. They render a deterministic gradient from a
stored `hue`, because inventing faces for people who do not exist is the wrong
default.

---

## Platform capabilities used

| Capability | Where |
| --- | --- |
| **Authentication** | `AuthGate` + `AuthOverlay`; public landing, gated app under `(app)/(protected)/` |
| **Realtime records** | `useQuery` / `useMutations` over the RecordRoom socket — matches and messages arrive with no refresh |
| **Permissions (RBAC)** | Per-collection rules above, incl. `'own'`, `'collaborator'`, `uniqueOn`, `userBound` |
| **File storage (R2)** | `useR2Files({ scope: 'app' })` for profile photos |
| **Messaging** | SDK `MESSAGES_SCHEMA` / `CHANNELS_SCHEMA` + `useMessages`, permissions tightened |
| **Server actions** | `swipe`, `sendMessage`, `saveProfile`, plus the developer-mode four |
| **Presence** | `usePresence().isOnline` drives the online dot in the conversation header |
| **Read receipts** | `useReadReceipts` for unread badges, with the SDK's permissive default tightened to `read: 'own'` |

The bundled `deepspace add messaging` feature was **not** used: it ships a
Slack-style multi-channel UI (sidebar, threads, invitations, member management)
that doesn't fit a two-person dating DM. The underlying schemas and hooks are
used directly instead.

---

## Known tradeoffs and rough edges

**Profile photos are world-readable.** Uploads use R2 scope `'app'`, whose URLs
carry no auth token, because a photo has to load in *another user's* browser as
a plain `<img src>`. Scope `'self'` requires the owner's `Authorization`
header and cannot be embedded across accounts. So a photo URL, if leaked, is
viewable by anyone holding it. A production build would want signed,
expiring URLs.

**Discovery does not scale.** The eligible stack is computed client-side from
"all profiles" minus "my swipes". That is correct and cheap for a prototype
and would fall over at thousands of users; real discovery needs server-side
pagination and exclusion.

**Matches and profile lookups are unpaginated** for the same reason.

**No message read state.** The matches list shows the latest message, but
there are no unread badges or read receipts. `READ_RECEIPTS_SCHEMA` exists in
the SDK and would be the way to add them.

**Presence is coarse.** `usePresence` reports online from a 60-second
heartbeat, so the dot can lag reality by up to a minute.

**Developer-mode AI replies are unmetered.** `devReply` is gated to fixtures
the caller owns, but there is no rate limit on it, so a determined developer
can burn their own Groq quota. Fine for a prototype, not for anything shared.

**Gender is a three-option enum.** Enough to make the matching rule real, and
plainly not enough for a product people would actually use.

**Photo upload has no crop or compression.** Files are capped client-side at
5 MB and the aspect ratio is whatever the user uploaded.

### Not built

Deliberately out of scope for an 8-hour prototype, and listed because a real
dating app cannot ship without them: age verification beyond a self-reported
number, blocking, reporting, content and image moderation, harassment
prevention, rate limiting, account deletion, data retention controls, location
privacy, and recommendation ranking.

---

## Project layout

```
src/
  actions/index.ts              swipe, sendMessage, saveProfile,
                                setDevMode, devSeed, devMatch, devReset, devReply
  schemas/hottake-schemas.ts    collections + the permission model
  schemas.ts                    schema registration
  lib/hottake.ts                action client, shared types
  lib/use-hottake.ts            profile/match/photo/directory hooks
  lib/dev-personas.ts           fixture generator (deterministic, dependency-free)
  components/ProfileForm.tsx    editor shared by onboarding and /profile
  components/Navigation.tsx     top bar + bottom tab bar
  pages/
    index.tsx                   static landing (no auth, no socket)
    (app)/_layout.tsx           auth + records providers, mobile column
    (app)/(protected)/          gated: onboarding, discover, matches,
                                messages/[id], profile
tests/
  hottake.spec.ts               the important path + permission boundaries
  dev-mode.spec.ts              fixtures, their scoping, and AI-reply guards
  ../src/lib/hottake.test.ts    unit tests for the matching predicates
  seed-demo.spec.ts             demo data utility (excluded from the suite)
```
