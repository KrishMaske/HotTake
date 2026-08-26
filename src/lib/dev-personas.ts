/**
 * Fixture people for developer mode.
 *
 * Deliberately fictional and deliberately photo-less: each one renders as a
 * deterministic gradient seeded by `hue` rather than an invented face. The
 * `persona` line exists only to give the AI reply action something to act
 * with, so the fixtures argue in character instead of all sounding the same.
 *
 * This module is imported by the worker, so it must stay dependency-free.
 */

import type { Gender } from '../schemas/hottake-schemas'

interface PersonaSeed {
  name: string
  gender: Gender
  persona: string
}

const PEOPLE: PersonaSeed[] = [
  { name: 'Maya', gender: 'woman', persona: 'deadpan, refuses to concede a point' },
  { name: 'Devon', gender: 'man', persona: 'over-explains, uses too many analogies' },
  { name: 'Sasha', gender: 'nonbinary', persona: 'chaotic, replies in fragments' },
  { name: 'Priya', gender: 'woman', persona: 'lawyerly, asks for your sources' },
  { name: 'Marcus', gender: 'man', persona: 'warm but relentlessly contrarian' },
  { name: 'Rowan', gender: 'nonbinary', persona: 'dry wit, very short messages' },
  { name: 'Nadia', gender: 'woman', persona: 'enthusiastic, escalates instantly' },
  { name: 'Theo', gender: 'man', persona: 'pretends to agree, then does not' },
  { name: 'Imani', gender: 'woman', persona: 'blunt, ends messages with a question' },
  { name: 'Felix', gender: 'man', persona: 'earnest, slightly too sincere' },
  { name: 'Juno', gender: 'nonbinary', persona: 'ironic, never fully serious' },
  { name: 'Camila', gender: 'woman', persona: 'competitive, keeps score' },
  { name: 'Oskar', gender: 'man', persona: 'calm, infuriatingly reasonable' },
  { name: 'Leila', gender: 'woman', persona: 'teasing, flirts by disagreeing' },
  { name: 'Ash', gender: 'nonbinary', persona: 'lowercase only, unbothered' },
  { name: 'Dmitri', gender: 'man', persona: 'grand pronouncements, no hedging' },
  { name: 'Yara', gender: 'woman', persona: 'curious, turns it back on you' },
  { name: 'Kenji', gender: 'man', persona: 'precise, mildly pedantic' },
  { name: 'Sloane', gender: 'woman', persona: 'withering one-liners' },
  { name: 'River', gender: 'nonbinary', persona: 'gentle, but will not budge' },
  { name: 'Amara', gender: 'woman', persona: 'storyteller, answers with anecdotes' },
  { name: 'Nico', gender: 'man', persona: 'playful, constant callbacks' },
  { name: 'Tessa', gender: 'woman', persona: 'sharp, allergic to small talk' },
  { name: 'Bodhi', gender: 'man', persona: 'unhurried, annoyingly zen' },
  { name: 'Wren', gender: 'nonbinary', persona: 'observant, notices your dodges' },
  { name: 'Farrah', gender: 'woman', persona: 'high energy, types fast' },
  { name: 'Idris', gender: 'man', persona: 'formal, oddly charming' },
  { name: 'Vera', gender: 'woman', persona: 'skeptical of everything, including this' },
  { name: 'Cassian', gender: 'man', persona: 'dramatic, treats it as a debate final' },
  { name: 'Nour', gender: 'nonbinary', persona: 'soft-spoken, devastating counterpoints' },
  { name: 'Delphine', gender: 'woman', persona: 'French-press snob energy' },
  { name: 'Ezra', gender: 'man', persona: 'self-aware, jokes about the app' },
  { name: 'Suki', gender: 'woman', persona: 'rapid-fire, never one message' },
  { name: 'Malik', gender: 'man', persona: 'steady, asks good follow-ups' },
  { name: 'Indigo', gender: 'nonbinary', persona: 'abstract, slightly cryptic' },
  { name: 'Rosalind', gender: 'woman', persona: 'academic, cites things' },
  { name: 'Anders', gender: 'man', persona: 'terse, agrees more than expected' },
  { name: 'Zaria', gender: 'woman', persona: 'confident, mildly condescending' },
  { name: 'Callum', gender: 'man', persona: 'friendly, hopeless at conceding' },
  { name: 'Emery', gender: 'nonbinary', persona: 'thoughtful, long pauses in text form' },
  { name: 'Ingrid', gender: 'woman', persona: 'sardonic, Nordic bluntness' },
  { name: 'Rafael', gender: 'man', persona: 'romantic about mundane things' },
  { name: 'Noor', gender: 'woman', persona: 'funny, deflects with jokes' },
  { name: 'Silas', gender: 'man', persona: 'contrarian for sport, admits it' },
  { name: 'Perry', gender: 'nonbinary', persona: 'cheerful, undermines you kindly' },
  { name: 'Xiomara', gender: 'woman', persona: 'passionate, types in bursts' },
  { name: 'Jonah', gender: 'man', persona: 'wry, understates everything' },
  { name: 'Astrid', gender: 'woman', persona: 'cool, hard to impress' },
  { name: 'Kai', gender: 'man', persona: 'agreeable until a specific trigger' },
  { name: 'Lux', gender: 'nonbinary', persona: 'theatrical, enjoys the argument' },
]

const HOT_TAKES: string[] = [
  'Breakfast food is better at night.',
  'Brunch is just overpriced breakfast.',
  'Concerts are better when you do not know the setlist.',
  'Iced coffee is better in winter.',
  'Pineapple belongs on pizza and this is not brave.',
  'The book is usually not better.',
  'Aisle seat people are the only honest travellers.',
  'Cereal is a soup and I will not be taking questions.',
  'Beaches are overrated. It is just hot sand and salt.',
  'Every song is too long by about forty seconds.',
  'Cilantro tastes fine and you are all being dramatic.',
  'Board game nights are a personality test, not entertainment.',
  'Dogs are needy. Cats have boundaries.',
  'The middle seasons of most shows are the best ones.',
  'Sparkling water is just water with anxiety.',
  'Nobody actually likes hiking, they like having hiked.',
  'Voice notes are a hate crime.',
  'Pancakes are structurally inferior to waffles.',
  'New Year fireworks are a waste of a perfectly good night.',
  'Reading two books at once is normal behaviour.',
  'Sandwiches taste better cut diagonally. This is physics.',
  'Bagels have gotten too big.',
  'Airport food is underrated because expectations are low.',
  'Group chats should have a hard cap of five people.',
  'Coffee shops should not have background music.',
  'Sunsets are just sunrises for people who slept in.',
  'Movie theatres are for people who cannot pause their lives.',
  'The best pizza topping is more cheese, not a second topping.',
  'Winter is objectively the superior season for going outside.',
  'Any recipe over eight ingredients is showing off.',
  'Autocorrect has made everyone a worse speller and we accepted it.',
  'Standing desks are a conspiracy against sitting.',
  'Tea is better than coffee and coffee people know it.',
  'Museums should be visited alone or not at all.',
  'The second slice of cake is always better than the first.',
  'Roadtrips are better than flights for anything under six hours.',
  'People who fold their pizza are correct.',
  'The best part of a burger is the bottom bun.',
  'Rain is the best weather to walk in.',
  'Playlists should never be shuffled.',
  'Breakfast burritos solved a problem nobody admits existed.',
  'Karaoke is only fun if you are slightly bad at it.',
  'Hotel breakfast is the peak of human civilisation.',
  'Board shorts have no business being worn outside water.',
  'Everyone secretly prefers the aisle over the window.',
  'Soup is a beverage if you are brave enough.',
  'The best chips are the burnt ones at the bottom.',
  'Mornings are only bad because of what we do with them.',
  'Sequels are usually better because the setup is done.',
  'Handwriting is a lost art and that is genuinely fine.',
]

/** Every gender, so a fixture can be generated to match any preference. */
const ALL_GENDERS: Gender[] = ['woman', 'man', 'nonbinary']

export interface GeneratedPersona {
  /** Index in the run. Paired with `ownerId` in a uniqueness constraint. */
  slot: number
  displayName: string
  age: number
  hotTake: string
  gender: Gender
  interestedIn: Gender[]
  hue: number
  persona: string
}

/**
 * Build `count` fixtures whose genders fall inside `wantedGenders`, and whose
 * own preferences include `viewerGender` — so every one of them is mutually
 * compatible with the developer and actually reaches the stack.
 *
 * Deterministic given the same inputs and `seed`, so a reseed is reproducible.
 */
export function generatePersonas(
  count: number,
  wantedGenders: Gender[],
  viewerGender: Gender,
  seed = 1,
): GeneratedPersona[] {
  const genders = wantedGenders.length > 0 ? wantedGenders : ALL_GENDERS
  // Small deterministic PRNG (mulberry32) — no dependency, repeatable.
  let state = seed >>> 0
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  // Prefer people who already have the wanted gender; top up by reassigning
  // when the pool for a narrow preference runs short.
  const pool = PEOPLE.filter((p) => genders.includes(p.gender))
  const source = pool.length >= count ? pool : PEOPLE

  const results: GeneratedPersona[] = []
  const usedNames = new Map<string, number>()

  for (let i = 0; i < count; i++) {
    const base = source[i % source.length]
    const gender = genders.includes(base.gender)
      ? base.gender
      : genders[Math.floor(random() * genders.length)]

    // Disambiguate if the pool wrapped and produced a repeat name.
    const seen = usedNames.get(base.name) ?? 0
    usedNames.set(base.name, seen + 1)
    const displayName = seen === 0 ? base.name : `${base.name} ${'IVX'[seen - 1] ?? seen + 1}`

    // Fixture preferences always include the developer, so nothing is filtered
    // out by the mutual-compatibility rule.
    const interestedIn = Array.from(
      new Set<Gender>([viewerGender, ...(random() > 0.55 ? ALL_GENDERS : [])]),
    )

    results.push({
      slot: i,
      displayName,
      age: 19 + Math.floor(random() * 17),
      hotTake: HOT_TAKES[(i * 7 + Math.floor(random() * 3)) % HOT_TAKES.length],
      gender,
      interestedIn,
      hue: Math.floor(random() * 360),
      persona: base.persona,
    })
  }

  return results
}
