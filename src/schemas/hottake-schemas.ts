/**
 * HotTake collections.
 *
 * The permission model here is the product, not an implementation detail, so
 * each rule below is deliberate:
 *
 *  - `profiles` are readable by every signed-in member (that IS discovery) but
 *    writable only by their owner.
 *  - `swipes` are `read: 'own'`. A user must never learn who liked them before
 *    a match exists, and that has to be a server-side rule rather than a
 *    hidden button. The consequence is that the *client* cannot detect a
 *    reciprocal like either — so match detection lives in the `swipe` server
 *    action (src/actions/index.ts), which is the only writer of this
 *    collection (`create: false` for members).
 *  - `matches`, `channels` and `messages` use `read: 'collaborator'` against a
 *    `participants` JSON array, so the Durable Object drops rows the caller is
 *    not a participant in *before* they ever reach the socket.
 *  - `dev-profiles` are `read: 'own'`: developer-mode fixtures are scoped to
 *    the developer who generated them by the permission layer, not by a
 *    client-side filter, so they can never leak into a real user's stack.
 *
 * Ownership is never taken from client input: every identity column is
 * `userBound: true`, which the RecordRoom overwrites with the verified JWT
 * subject on create (see putRecord in deepspace/dist/worker.js).
 */

import {
  CHANNELS_SCHEMA,
  MESSAGES_SCHEMA,
  READ_RECEIPTS_SCHEMA,
  type CollectionSchema,
} from 'deepspace/schema'

/** Hot takes are a one-liner, not an essay. Enforced in UI and in the action. */
export const HOT_TAKE_MAX = 140
/** Prototype gate only — a real dating app needs actual age verification. */
export const MIN_AGE = 18
export const MAX_AGE = 120

export const GENDERS = ['woman', 'man', 'nonbinary'] as const
export type Gender = (typeof GENDERS)[number]

export const GENDER_LABELS: Record<Gender, string> = {
  woman: 'Woman',
  man: 'Man',
  nonbinary: 'Non-binary',
}

/** Plural form, for the "interested in" picker. */
export const GENDER_PLURALS: Record<Gender, string> = {
  woman: 'Women',
  man: 'Men',
  nonbinary: 'Non-binary people',
}

/** How many fixture profiles a developer-mode seed creates. */
export const DEV_PROFILE_COUNT = 50

/**
 * Shared by matches/channels/messages: the two participant ids allowed to see
 * the row. `collaboratorsField` points the RBAC layer at it, and
 * `'collaborator'` resolves to "owner OR listed here".
 */
const participantsColumn = {
  name: 'participants',
  storage: 'text',
  interpretation: { kind: 'json' },
  required: true,
} as const

export const profilesSchema: CollectionSchema = {
  name: 'profiles',
  columns: [
    { name: 'userId', storage: 'text', interpretation: 'plain', userBound: true, immutable: true },
    { name: 'displayName', storage: 'text', interpretation: 'plain', required: true },
    { name: 'age', storage: 'number', interpretation: 'plain', required: true },
    { name: 'hotTake', storage: 'text', interpretation: 'plain', required: true },
    { name: 'photoKey', storage: 'text', interpretation: 'plain', required: true },
    {
      name: 'gender',
      storage: 'text',
      interpretation: { kind: 'select', options: [...GENDERS] },
      required: true,
    },
    // A JSON array rather than a single value: "interested in" is genuinely
    // multi-valued, and a select would force everyone into three buckets.
    { name: 'interestedIn', storage: 'text', interpretation: { kind: 'json' }, required: true },
    // Developer mode is per-account state, so it lives on the profile rather
    // than in localStorage — it has to be readable by the server actions that
    // decide whether to serve fixtures.
    { name: 'devMode', storage: 'number', interpretation: { kind: 'boolean' } },
  ],
  ownerField: 'userId',
  // One profile per human, enforced in SQLite rather than by a read-then-write
  // race in the client.
  uniqueOn: ['userId'],
  permissions: {
    '*': { read: false, create: false, update: false, delete: false },
    viewer: { read: false, create: false, update: false, delete: false },
    member: { read: true, create: true, update: 'own', delete: false },
    admin: { read: true, create: true, update: true, delete: true },
  },
}

/**
 * Developer-mode fixture profiles.
 *
 * These are real records so that matches and conversations against them behave
 * exactly like the real thing — but `read: 'own'` means the record room only
 * ever ships a developer their *own* fixtures. Another user cannot see them
 * even if they go looking, which is why this is a separate collection rather
 * than a `synthetic: true` flag on `profiles`.
 *
 * They carry no photo. `hue` seeds a deterministic gradient in the UI instead,
 * which keeps seeding instant and avoids inventing images of people who do not
 * exist.
 */
export const devProfilesSchema: CollectionSchema = {
  name: 'dev-profiles',
  columns: [
    { name: 'ownerId', storage: 'text', interpretation: 'plain', userBound: true, immutable: true },
    { name: 'displayName', storage: 'text', interpretation: 'plain', required: true },
    { name: 'age', storage: 'number', interpretation: 'plain', required: true },
    { name: 'hotTake', storage: 'text', interpretation: 'plain', required: true },
    {
      name: 'gender',
      storage: 'text',
      interpretation: { kind: 'select', options: [...GENDERS] },
      required: true,
    },
    { name: 'interestedIn', storage: 'text', interpretation: { kind: 'json' }, required: true },
    { name: 'hue', storage: 'number', interpretation: 'plain', required: true },
    /** One line of extra character, used only to steer the AI's replies. */
    { name: 'persona', storage: 'text', interpretation: 'plain' },
    /**
     * This fixture's index in the generated run, 0..DEV_PROFILE_COUNT-1.
     *
     * Exists to make seeding safe under concurrency. Without it, `devSeed`
     * decides what to create by counting rows, which is a read-then-write
     * race: two overlapping seed loops both read the same count and both
     * write the same batch. With `uniqueOn` below, the second write is
     * rejected by the database instead, so the set can never exceed its size
     * no matter how many callers race.
     */
    { name: 'slot', storage: 'number', interpretation: 'plain', required: true },
  ],
  ownerField: 'ownerId',
  uniqueOn: ['ownerId', 'slot'],
  permissions: {
    '*': { read: false, create: false, update: false, delete: false },
    viewer: { read: false, create: false, update: false, delete: false },
    // create:false — only the devSeed action mints fixtures. delete:'own' lets
    // a developer clear their own without an admin round-trip.
    member: { read: 'own', create: false, update: false, delete: 'own' },
    admin: { read: true, create: false, update: false, delete: true },
  },
}

export const swipesSchema: CollectionSchema = {
  name: 'swipes',
  columns: [
    { name: 'swiperId', storage: 'text', interpretation: 'plain', userBound: true, immutable: true },
    { name: 'targetId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    {
      name: 'direction',
      storage: 'text',
      interpretation: { kind: 'select', options: ['like', 'pass'] },
      required: true,
    },
  ],
  ownerField: 'swiperId',
  // The "one effective swipe per pair" rule. Also makes the swipe action
  // idempotent under double-clicks and retries.
  uniqueOn: ['swiperId', 'targetId'],
  permissions: {
    '*': { read: false, create: false, update: false, delete: false },
    viewer: { read: false, create: false, update: false, delete: false },
    // read:'own' is what keeps "who liked me" secret. create:false makes the
    // swipe action the only writer, so the no-self-swipe and reciprocity
    // rules cannot be bypassed by talking to the record room directly.
    member: { read: 'own', create: false, update: false, delete: 'own' },
    admin: { read: true, create: false, update: false, delete: true },
  },
}

export const matchesSchema: CollectionSchema = {
  name: 'matches',
  columns: [
    participantsColumn,
    { name: 'pairKey', storage: 'text', interpretation: 'plain', required: true },
    { name: 'channelId', storage: 'text', interpretation: 'plain', required: true },
    // True when the other participant is a dev-profile fixture rather than a
    // real user. The UI resolves their identity from `dev-profiles` and hides
    // the match entirely when developer mode is off.
    { name: 'synthetic', storage: 'number', interpretation: { kind: 'boolean' } },
  ],
  collaboratorsField: 'participants',
  // pairKey is the sorted "a::b" id pair, so a reciprocal like can only ever
  // produce one match row even if both sides land at the same instant.
  uniqueOn: ['pairKey'],
  permissions: {
    '*': { read: false, create: false, update: false, delete: false },
    viewer: { read: false, create: false, update: false, delete: false },
    member: { read: 'collaborator', create: false, update: false, delete: false },
    admin: { read: true, create: false, update: false, delete: true },
  },
}

/**
 * The SDK's messaging schemas, with their permissions tightened.
 *
 * Both ship `member: { read: true }` — fine for a team chat where everyone is
 * in the same room, wrong for private DMs between strangers: any signed-in
 * user could read every message in the app. We keep the SDK's columns (so
 * `useMessages` still works verbatim) and swap the permission block for
 * participant-scoped access.
 */
export const channelsSchema: CollectionSchema = {
  ...CHANNELS_SCHEMA,
  columns: [...CHANNELS_SCHEMA.columns, participantsColumn],
  collaboratorsField: 'participants',
  permissions: {
    '*': { read: false, create: false, update: false, delete: false },
    viewer: { read: false, create: false, update: false, delete: false },
    member: { read: 'collaborator', create: false, update: false, delete: false },
    admin: { read: true, create: false, update: false, delete: true },
  },
}

export const messagesSchema: CollectionSchema = {
  ...MESSAGES_SCHEMA,
  columns: [
    ...MESSAGES_SCHEMA.columns,
    participantsColumn,
    /**
     * Who the message is *from*, for display.
     *
     * Distinct from the SDK's `authorId`, which is `userBound` and therefore
     * always the authenticated account that wrote the row. For a developer-mode
     * AI reply those differ: `authorId` stays the developer (an honest audit
     * trail — their account's request created it) while `senderId` is the
     * fixture profile the message is attributed to in the UI.
     */
    { name: 'senderId', storage: 'text', interpretation: 'plain', required: true },
  ],
  collaboratorsField: 'participants',
  permissions: {
    '*': { read: false, create: false, update: false, delete: false },
    viewer: { read: false, create: false, update: false, delete: false },
    // create:false — the sendMessage action re-checks that a match still
    // exists before writing, so "you can only message a match" is enforced on
    // the server rather than by which buttons we render.
    member: { read: 'collaborator', create: false, update: false, delete: 'own' },
    admin: { read: true, create: false, update: false, delete: true },
  },
}

/**
 * Read receipts, scoped to their owner.
 *
 * The SDK default is `member: { read: true }`, which would publish "when did
 * this person last open our chat" to every signed-in user. Only you need to
 * see your own cursor, so this is `read: 'own'`. Writes stay direct — `userId`
 * is `userBound`, so a client can only ever move its own marker.
 */
export const readReceiptsSchema: CollectionSchema = {
  ...READ_RECEIPTS_SCHEMA,
  permissions: {
    '*': { read: false, create: false, update: false, delete: false },
    viewer: { read: false, create: false, update: false, delete: false },
    member: { read: 'own', create: true, update: 'own', delete: 'own' },
    admin: { read: true, create: false, update: false, delete: true },
  },
}
