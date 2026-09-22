/**
 * Profile + appearance + session controls.
 * Forms use React Hook Form with the shared Zod schema and inline,
 * field-level errors (16 s8) - never a generic banner for validation.
 */
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { profileUpdateSchema, type ProfileUpdateInput } from '../../../shared/validation';
import type { Profile, UserSettings } from '../../../shared/types';
import { Avatar } from '../../components/AppShell';
import {
  Button,
  Card,
  FieldError,
  Hint,
  Input,
  Label,
  SectionTitle,
  Skeleton,
  Textarea,
} from '../../components/ui/primitives';
import { useToast } from '../../components/ui/overlays';
import { useSession } from '../../hooks/use-session';
import { ApiError, apiGet, apiPatch } from '../../lib/api';
import { THEMES, type ThemeId } from '../../lib/theme';
import { formatDateMedium } from '../../lib/format';
import { cn } from '../../lib/cn';

export function ProfileTab() {
  const { user, signOut, theme, setTheme } = useSession();
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['profile'],
    queryFn: () => apiGet<{ profile: Profile; settings: UserSettings }>('/api/profile'),
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<ProfileUpdateInput>({ resolver: zodResolver(profileUpdateSchema) });

  useEffect(() => {
    if (data?.profile) {
      reset({
        displayName: data.profile.displayName,
        fullName: data.profile.fullName ?? '',
        bio: data.profile.bio ?? '',
      });
    }
  }, [data, reset]);

  const update = useMutation({
    mutationFn: (values: ProfileUpdateInput) => apiPatch('/api/profile', values),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['profile'] });
      toast({ title: 'Profile saved', tone: 'success' });
    },
    onError: (e) =>
      toast({
        title: 'Could not save profile',
        description: e instanceof ApiError ? e.message : undefined,
        tone: 'danger',
      }),
  });

  if (isLoading) {
    return (
      <Card className="space-y-4">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center gap-4 mb-5">
          <Avatar name={user?.displayName ?? '?'} size={56} />
          <div className="min-w-0">
            <p className="text-[16px] font-semibold text-[var(--text-1)] truncate">
              {user?.displayName}
            </p>
            <p className="text-[13px] text-[var(--text-3)] truncate">{user?.email}</p>
            <p className="text-[11.5px] text-[var(--text-3)] mt-1">
              Member since{' '}
              {user ? formatDateMedium(new Date(user.createdAt).toISOString().slice(0, 10)) : '—'}
              {user?.authProvider === 'GOOGLE' ? ' · Google account' : ''}
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit((v) => update.mutate(v))} noValidate className="space-y-4">
          <div>
            <Label htmlFor="displayName" required>Display name</Label>
            <Input id="displayName" invalid={Boolean(errors.displayName)} {...register('displayName')} />
            <FieldError>{errors.displayName?.message}</FieldError>
          </div>
          <div>
            <Label htmlFor="fullName">Full name</Label>
            <Input id="fullName" invalid={Boolean(errors.fullName)} {...register('fullName')} />
            <FieldError>{errors.fullName?.message}</FieldError>
            <Hint>Appears on exported PDF documents.</Hint>
          </div>
          <div>
            <Label htmlFor="bio">Bio</Label>
            <Textarea id="bio" rows={3} {...register('bio')} />
            <FieldError>{errors.bio?.message}</FieldError>
          </div>
          <div className="flex justify-end">
            <Button type="submit" variant="primary" loading={update.isPending} disabled={!isDirty}>
              Save changes
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <SectionTitle title="Appearance" subtitle="Applies immediately and syncs to your account" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTheme(t.id as ThemeId)}
              className={cn(
                'rounded-lg border p-2.5 text-left transition-all duration-150',
                theme === t.id
                  ? 'border-[var(--accent)] ring-2 ring-[var(--accent-soft)]'
                  : 'border-[var(--border)] hover:border-[var(--border-strong)]',
              )}
            >
              <span
                className="block h-9 rounded mb-2 relative overflow-hidden"
                style={{ background: t.bg }}
                aria-hidden
              >
                <span
                  className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full"
                  style={{ background: t.swatch }}
                />
                <span
                  className="absolute left-1.5 bottom-1.5 h-1 w-8 rounded-full"
                  style={{ background: t.swatch, opacity: 0.45 }}
                />
              </span>
              <span className="text-[12px] font-medium text-[var(--text-1)] block truncate">
                {t.label}
              </span>
              <span className="text-[10.5px] text-[var(--text-3)]">{t.group}</span>
            </button>
          ))}
        </div>
      </Card>

      <Card>
        <SectionTitle title="Session" subtitle="Sign out of this device" />
        <p className="text-[13px] text-[var(--text-2)] leading-relaxed mb-3.5">
          Unsynced changes stay safely on this device and will sync the next time you sign in here.
        </p>
        <Button variant="secondary" onClick={() => void signOut()}>
          Sign out
        </Button>
      </Card>
    </div>
  );
}
