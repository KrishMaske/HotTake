/**
 * First-run profile creation. The (protected) layout routes any signed-in user
 * without a profile here, and back out to /discover once one exists.
 */

import { useNavigate } from 'react-router-dom'
import ProfileForm from '../../../components/ProfileForm'
import { useMyProfile } from '../../../lib/use-hottake'

export default function Onboarding() {
  const navigate = useNavigate()
  // A returning user finishing a pre-gender profile keeps what they already
  // wrote; only the new fields are actually missing.
  const { profile } = useMyProfile()
  const returning = !!profile

  return (
    <div className="pb-8">
      <header className="px-6 pt-8">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          {returning ? 'Finish your profile' : 'One photo. One opinion.'}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {returning
            ? 'We added gender and preferences. Fill those in and you are back.'
            : "That's the whole profile. Make the opinion count."}
        </p>
      </header>

      <ProfileForm
        initial={profile?.data}
        submitLabel="Enter HotTake"
        onSaved={() => navigate('/discover', { replace: true })}
      />
    </div>
  )
}
