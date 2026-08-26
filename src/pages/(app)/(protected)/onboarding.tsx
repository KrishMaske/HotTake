/**
 * First-run profile creation. The (protected) layout routes any signed-in user
 * without a profile here, and back out to /discover once one exists.
 */

import { useNavigate } from 'react-router-dom'
import ProfileForm from '../../../components/ProfileForm'

export default function Onboarding() {
  const navigate = useNavigate()

  return (
    <div className="pb-8">
      <header className="px-6 pt-8">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          One photo. One opinion.
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          That&rsquo;s the whole profile. Make the opinion count.
        </p>
      </header>

      <ProfileForm submitLabel="Enter HotTake" onSaved={() => navigate('/discover', { replace: true })} />
    </div>
  )
}
