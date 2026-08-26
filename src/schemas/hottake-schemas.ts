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
 *
 * Ownership is never taken from client input: every identity column is
 * `userBound: true`, which the RecordRoom overwrites with the verified JWT
 * subject on create (see putRecord in deepspace/dist/worker.js).
 */

import { CHANNELS_SCHEMA, MESSAGES_SCHEMA, type CollectionSchema } from 'deepspace/schema'

/** Hot takes are a one-liner, not an essay. Enforced in UI and in the action. */
export const HOT_TAKE_MAX = 140
/** Prototype gate only — a real dating app needs actual age verification. */
export const MIN_AGE = 18
export const MAX_AGE = 120

/**
 * Shared by matches/channels/messages: the two user ids allowed to see the
 * row. `collaboratorsField` points the RBAC layer at it, and `'collaborator'`
 * resolves to "owner OR listed here".
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
    member: { read: 'own', create: false, update: false, delete: false },
    admin: { read: true, create: false, update: false, delete: true },
  },
}

export const matchesSchema: CollectionSchema = {
  name: 'matches',
  columns: [
    participantsColumn,
    { name: 'pairKey', storage: 'text', interpretation: 'plain', required: true },
    { name: 'channelId', storage: 'text', interpretation: 'plain', required: true },
  ],
  collaboratorsField: 'participants',
  // pairKey is the sorted "a:b" id pair, so a reciprocal like can only ever
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
  columns: [...MESSAGES_SCHEMA.columns, participantsColumn],
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
