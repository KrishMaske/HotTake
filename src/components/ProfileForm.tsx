/**
 * The profile editor, shared by /onboarding and /profile.
 *
 * Photo handling note: uploads use R2 scope `'app'`, which is world-readable.
 * That is deliberate and it is the one real privacy tradeoff in the app —
 * profile photos have to be loadable as a plain `<img src>` by *other* users'
 * browsers, and scope `'self'` files require the owner's Authorization header.
 * The uploaded key is what we persist on the profile record.
 */

import { useRef, useState, type FormEvent } from 'react'
import { useR2Files } from 'deepspace'
import { Camera, Check, Loader2 } from 'lucide-react'
import { useToast } from '@/components/ui'
import { ActionError, callAction, readJsonArray, type Profile } from '../lib/hottake'
import {
  GENDERS,
  GENDER_LABELS,
  GENDER_PLURALS,
  HOT_TAKE_MAX,
  MAX_AGE,
  MIN_AGE,
  type Gender,
} from '../schemas/hottake-schemas'
import { cn } from '../lib/utils'

/** Client-side guard only; the platform enforces its own ceiling regardless. */
const MAX_PHOTO_BYTES = 5 * 1024 * 1024

interface ProfileFormProps {
  initial?: Profile
  submitLabel: string
  onSaved: () => void
}

export default function ProfileForm({ initial, submitLabel, onSaved }: ProfileFormProps) {
  const { upload, getUrl } = useR2Files({ scope: 'app' })
  const { error: toastError } = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [displayName, setDisplayName] = useState(initial?.displayName ?? '')
  const [age, setAge] = useState(initial?.age ? String(initial.age) : '')
  const [hotTake, setHotTake] = useState(initial?.hotTake ?? '')
  const [photoKey, setPhotoKey] = useState(initial?.photoKey ?? '')
  const [gender, setGender] = useState<Gender | ''>(initial?.gender ?? '')
  const [interestedIn, setInterestedIn] = useState<Gender[]>(
    (readJsonArray(initial?.interestedIn) as Gender[]) ?? [],
  )
  // A local object URL previews the pick instantly; the R2 URL takes over once
  // the upload lands.
  const [preview, setPreview] = useState<string | undefined>(
    initial?.photoKey ? getUrl(initial.photoKey) : undefined,
  )
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const ageNumber = Number(age)
  const ageValid = Number.isInteger(ageNumber) && ageNumber >= MIN_AGE && ageNumber <= MAX_AGE
  const canSubmit =
    displayName.trim().length > 0 &&
    ageValid &&
    gender !== '' &&
    interestedIn.length > 0 &&
    hotTake.trim().length > 0 &&
    hotTake.length <= HOT_TAKE_MAX &&
    photoKey.length > 0 &&
    !uploading &&
    !saving

  function toggleInterest(value: Gender) {
    setInterestedIn((prev) =>
      prev.includes(value) ? prev.filter((g) => g !== value) : [...prev, value],
    )
  }

  async function handlePhoto(file: File) {
    if (!file.type.startsWith('image/')) {
      toastError('That is not an image', 'Pick a JPG, PNG, or WebP.')
      return
    }
    if (file.size > MAX_PHOTO_BYTES) {
      toastError('That photo is too big', 'Keep it under 5 MB.')
      return
    }

    const localUrl = URL.createObjectURL(file)
    setPreview(localUrl)
    setUploading(true)
    try {
      const result = await upload(file)
      if (!result.success || !result.key) throw new Error(result.error ?? 'Upload failed')
      setPhotoKey(result.key)
      setPreview(getUrl(result.key))
      URL.revokeObjectURL(localUrl)
    } catch {
      // Roll the preview back so the UI never implies a photo that isn't stored.
      URL.revokeObjectURL(localUrl)
      setPreview(initial?.photoKey ? getUrl(initial.photoKey) : undefined)
      setPhotoKey(initial?.photoKey ?? '')
      toastError("Couldn't upload your photo", 'Try again.')
    } finally {
      setUploading(false)
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit) return
    setSaving(true)
    setFormError(null)
    try {
      // The action re-validates all of this server-side; the checks above are
      // only there to keep the button honest.
      await callAction('saveProfile', {
        displayName: displayName.trim(),
        age: ageNumber,
        hotTake: hotTake.trim(),
        photoKey,
        gender,
        interestedIn,
      })
      onSaved()
    } catch (err) {
      setFormError(
        err instanceof ActionError ? err.message : "Couldn't save your profile. Try again.",
      )
    } finally {
      setSaving(false)
    }
  }

  const remaining = HOT_TAKE_MAX - hotTake.length

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-7 px-6 py-6">
      <div className="flex flex-col items-center gap-3">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          data-testid="photo-picker"
          className="relative flex h-44 w-44 items-center justify-center overflow-hidden rounded-[2rem] border border-border bg-card transition-colors hover:border-primary disabled:cursor-wait"
          aria-label={photoKey ? 'Change your photo' : 'Add your photo'}
        >
          {preview ? (
            <img src={preview} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex flex-col items-center gap-2 text-muted-foreground">
              <Camera className="h-7 w-7" aria-hidden />
              <span className="text-xs font-medium">Add your photo</span>
            </span>
          )}
          {uploading && (
            <span className="absolute inset-0 flex items-center justify-center bg-background/70">
              <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden />
            </span>
          )}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            // Reset so re-picking the same file still fires a change event.
            e.target.value = ''
            if (file) void handlePhoto(file)
          }}
        />
      </div>

      <div className="grid grid-cols-[1fr_auto] gap-3">
        <Field label="Name">
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={40}
            placeholder="Alex"
            data-testid="input-name"
            className={inputClass}
          />
        </Field>
        <Field label="Age">
          <input
            value={age}
            onChange={(e) => setAge(e.target.value.replace(/\D/g, '').slice(0, 3))}
            inputMode="numeric"
            placeholder="21"
            data-testid="input-age"
            className={cn(inputClass, 'w-20 text-center')}
          />
        </Field>
      </div>
      {age.length > 0 && !ageValid && (
        <p className="-mt-5 text-xs text-destructive">
          You must be {MIN_AGE} or older to use HotTake.
        </p>
      )}

      <Field label="You are">
        <div className="flex flex-wrap gap-2" data-testid="gender-picker">
          {GENDERS.map((value) => (
            <Chip
              key={value}
              selected={gender === value}
              onClick={() => setGender(value)}
              testId={`gender-${value}`}
            >
              {GENDER_LABELS[value]}
            </Chip>
          ))}
        </div>
      </Field>

      <Field label="Show you" hint="Pick as many as you like">
        <div className="flex flex-wrap gap-2" data-testid="interest-picker">
          {GENDERS.map((value) => (
            <Chip
              key={value}
              selected={interestedIn.includes(value)}
              onClick={() => toggleInterest(value)}
              testId={`interest-${value}`}
            >
              {GENDER_PLURALS[value]}
            </Chip>
          ))}
        </div>
      </Field>

      <Field label="Your hot take">
        <textarea
          value={hotTake}
          onChange={(e) => setHotTake(e.target.value.slice(0, HOT_TAKE_MAX))}
          rows={3}
          placeholder="What's an opinion you'll defend forever?"
          data-testid="input-hot-take"
          className={cn(inputClass, 'resize-none')}
        />
        <span
          className={cn(
            'self-end text-xs',
            remaining < 20 ? 'text-primary' : 'text-muted-foreground',
          )}
        >
          {hotTake.length} / {HOT_TAKE_MAX}
        </span>
      </Field>

      {formError && (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      )}

      <button
        type="submit"
        disabled={!canSubmit}
        data-testid="submit-profile"
        className="flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3.5 text-base font-semibold text-primary-foreground transition-all hover:opacity-90 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        {submitLabel}
      </button>
    </form>
  )
}

const inputClass =
  'rounded-2xl border border-border bg-card px-4 py-3 text-base text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary'

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="flex items-baseline gap-2">
        <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {label}
        </span>
        {hint && <span className="text-[11px] text-muted-foreground/70">{hint}</span>}
      </span>
      {children}
    </label>
  )
}

function Chip({
  selected,
  onClick,
  testId,
  children,
}: {
  selected: boolean
  onClick: () => void
  testId: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      data-testid={testId}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium transition-colors',
        selected
          ? 'border-primary bg-primary/15 text-foreground'
          : 'border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground',
      )}
    >
      {selected && <Check className="h-3.5 w-3.5 text-primary" aria-hidden />}
      {children}
    </button>
  )
}
