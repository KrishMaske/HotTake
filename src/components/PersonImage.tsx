/**
 * A person's picture, wherever they came from.
 *
 * Real profiles have an R2 photo key. Developer-mode fixtures deliberately do
 * not — inventing faces for people who do not exist is the wrong default — so
 * they render a deterministic gradient with their initial instead. Keeping
 * both behind one component means no calling site has to care which it has.
 */

import { hueGradient, type DisplayProfile } from '../lib/hottake'
import { cn } from '../lib/utils'

interface PersonImageProps {
  person: Pick<DisplayProfile, 'displayName' | 'photoKey' | 'hue' | 'synthetic'> | undefined
  photoUrl: (key: string | undefined) => string | undefined
  className?: string
  /** Scales the fallback initial; the gradient block has no intrinsic size. */
  initialClassName?: string
}

export default function PersonImage({
  person,
  photoUrl,
  className,
  initialClassName = 'text-2xl',
}: PersonImageProps) {
  const src = person?.photoKey ? photoUrl(person.photoKey) : undefined

  if (src) {
    return (
      <img
        src={src}
        alt=""
        loading="lazy"
        className={cn('bg-muted object-cover', className)}
      />
    )
  }

  const initial = person?.displayName?.[0]?.toUpperCase() ?? '?'
  return (
    <div
      aria-hidden="true"
      className={cn('flex items-center justify-center bg-muted', className)}
      style={person?.hue !== undefined ? { backgroundImage: hueGradient(person.hue) } : undefined}
    >
      <span className={cn('font-bold text-white/85', initialClassName)}>{initial}</span>
    </div>
  )
}
