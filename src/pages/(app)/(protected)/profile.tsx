/**
 * The signed-in user's own profile, with an inline editor.
 *
 * Editing is gated by `update: 'own'` on the profiles schema plus `ownerField:
 * 'userId'` — and `userId` is `userBound`, so it's stamped from the verified
 * JWT and can't be reassigned. The Edit button below is convenience; the rule
 * is the schema.
 */

import { useState } from 'react'
import { signOut } from 'deepspace'
import { Flame } from 'lucide-react'
import ProfileForm from '../../../components/ProfileForm'
import { useMyProfile, usePhotoUrl } from '../../../lib/use-hottake'

export default function ProfilePage() {
  const { profile, loading } = useMyProfile()
  const photoUrl = usePhotoUrl()
  const [editing, setEditing] = useState(false)

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Flame className="h-6 w-6 animate-pulse text-primary" aria-hidden />
        <span className="sr-only">Loading profile</span>
      </div>
    )
  }

  if (!profile) return null

  if (editing) {
    return (
      <div className="pb-8">
        <header className="flex items-center justify-between px-6 pt-6">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Edit profile</h1>
          <button
            onClick={() => setEditing(false)}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
        </header>
        <ProfileForm
          initial={profile.data}
          submitLabel="Save changes"
          onSaved={() => setEditing(false)}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center px-6 py-8">
      <img
        src={photoUrl(profile.data.photoKey)}
        alt=""
        data-testid="profile-photo"
        className="h-40 w-40 rounded-3xl bg-muted object-cover"
      />

      <h1 className="mt-5 text-2xl font-bold tracking-tight text-foreground">
        {profile.data.displayName}, {profile.data.age}
      </h1>

      <div className="mt-6 w-full rounded-2xl border border-border bg-card px-5 py-4">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-primary">
          Your hot take
        </p>
        <p className="mt-2 text-[15px] leading-snug text-card-foreground">
          &ldquo;{profile.data.hotTake}&rdquo;
        </p>
      </div>

      <button
        onClick={() => setEditing(true)}
        data-testid="edit-profile"
        className="mt-6 w-full rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
      >
        Edit profile
      </button>

      <button
        onClick={() => signOut()}
        className="mt-3 w-full rounded-full px-6 py-3 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        Sign out
      </button>
    </div>
  )
}
