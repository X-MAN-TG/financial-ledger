/**
 * Account creation. Capacity is bounded by MAX_USERS (a wrangler [vars]
 * value, never hard-coded); the Worker returns USER_LIMIT_REACHED when the
 * cap is hit and the UI explains it plainly.
 */
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate } from 'react-router-dom';
import { signupSchema, type SignupInput } from '../../../shared/validation';
import { ApiError, apiPost } from '../../lib/api';
import { Button, FieldError, Hint, Input, Label } from '../../components/ui/primitives';
import { useSession } from '../../hooks/use-session';
import { AuthLayout } from './AuthLayout';
import { PasswordInput } from './PasswordInput';

function strength(pw: string): { score: number; label: string } {
  let score = 0;
  if (pw.length >= 12) score++;
  if (pw.length >= 16) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  const labels = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong', 'Excellent'];
  return { score, label: labels[Math.min(score, 5)] };
}

export function SignupPage() {
  const navigate = useNavigate();
  const { refresh } = useSession();
  const [formError, setFormError] = useState<string | null>(null);
  const [capacityFull, setCapacityFull] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<SignupInput>({ resolver: zodResolver(signupSchema), mode: 'onBlur' });

  const pw = watch('password') ?? '';
  const s = strength(pw);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    setCapacityFull(false);
    try {
      await apiPost('/api/auth/signup', values);
      await refresh();
      navigate('/ledger', { replace: true });
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.code === 'USER_LIMIT_REACHED') {
          setCapacityFull(true);
          return;
        }
        setFormError(e.message);
      } else {
        setFormError('Could not create the account. Please try again.');
      }
    }
  });

  if (capacityFull) {
    return (
      <AuthLayout
        title="Registration is closed"
        subtitle="This private instance has reached its configured user limit. Ask the owner to make a place for you."
        footer={
          <Link to="/login" className="text-[var(--accent)] font-medium hover:underline">
            Back to sign in
          </Link>
        }
      >
        <div
          className="rounded-lg px-4 py-3.5 text-[13px] leading-relaxed"
          style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}
        >
          No further accounts can be created until the owner frees a slot or raises the limit.
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle="A private ledger for your own financial records."
      footer={
        <p>
          Already have an account?{' '}
          <Link to="/login" className="text-[var(--accent)] font-medium hover:underline">
            Sign in
          </Link>
        </p>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && (
          <div
            role="alert"
            className="rounded-md px-3.5 py-3 text-[13px] leading-snug"
            style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}
          >
            {formError}
          </div>
        )}

        <div>
          <Label htmlFor="displayName" required>Display name</Label>
          <Input
            id="displayName"
            autoComplete="name"
            placeholder="How your name appears in the app"
            invalid={Boolean(errors.displayName)}
            {...register('displayName')}
          />
          <FieldError>{errors.displayName?.message}</FieldError>
        </div>

        <div>
          <Label htmlFor="email" required>Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="you@example.com"
            invalid={Boolean(errors.email)}
            {...register('email')}
          />
          <FieldError>{errors.email?.message}</FieldError>
        </div>

        <div>
          <Label htmlFor="password" required>Password</Label>
          <PasswordInput
            id="password"
            autoComplete="new-password"
            invalid={Boolean(errors.password)}
            {...register('password')}
          />
          {pw.length > 0 && !errors.password && (
            <div className="mt-2 flex items-center gap-2">
              <div className="flex-1 h-1 rounded-full bg-[var(--surface-3)] overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${(s.score / 5) * 100}%`,
                    background:
                      s.score <= 1 ? 'var(--danger)' : s.score <= 3 ? 'var(--warning)' : 'var(--success)',
                  }}
                />
              </div>
              <span className="text-[11.5px] text-[var(--text-3)] w-16 text-right">{s.label}</span>
            </div>
          )}
          <FieldError>{errors.password?.message}</FieldError>
          {!errors.password && pw.length === 0 && (
            <Hint>Use a long passphrase. Length matters more than symbols.</Hint>
          )}
        </div>

        <Button type="submit" variant="primary" size="lg" className="w-full" loading={isSubmitting}>
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
