/**
 * User sign-in (04 section 2). Uses the SHARED Zod schema so the client and
 * Worker validate identically - no drift between the two.
 */
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate } from 'react-router-dom';
import { loginSchema, type LoginInput } from '../../../shared/validation';
import { ApiError, apiPost } from '../../lib/api';
import { Button, FieldError, Input, Label } from '../../components/ui/primitives';
import { useSession } from '../../hooks/use-session';
import { AuthLayout } from './AuthLayout';
import { PasswordInput } from './PasswordInput';

export function LoginPage() {
  const navigate = useNavigate();
  const { refresh } = useSession();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema), mode: 'onBlur' });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await apiPost('/api/auth/login', values);
      await refresh();
      navigate('/ledger', { replace: true });
    } catch (e) {
      // Generic message by design: never reveal whether the email exists
      // (20-security.txt, user enumeration).
      if (e instanceof ApiError) {
        setFormError(
          e.status === 429
            ? 'Too many attempts. Please wait a moment and try again.'
            : e.status === 0
              ? 'You appear to be offline. Sign-in needs a connection.'
              : e.message,
        );
      } else {
        setFormError('Could not sign in. Please try again.');
      }
    }
  });

  return (
    <AuthLayout
      title="Sign in"
      subtitle="Access your private transaction ledger."
      footer={
        <div className="space-y-2">
          <p>
            Need an account?{' '}
            <Link to="/signup" className="text-[var(--accent)] font-medium hover:underline">
              Request access
            </Link>
          </p>
          <p className="text-[12px]">
            <Link to="/owner/login" className="text-[var(--text-3)] hover:text-[var(--text-2)] hover:underline">
              Owner sign-in
            </Link>
          </p>
        </div>
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
            autoComplete="current-password"
            invalid={Boolean(errors.password)}
            {...register('password')}
          />
          <FieldError>{errors.password?.message}</FieldError>
        </div>

        <Button type="submit" variant="primary" size="lg" className="w-full" loading={isSubmitting}>
          Sign in
        </Button>

        <div className="flex items-center gap-3 py-1">
          <span className="h-px flex-1 bg-[var(--border)]" />
          <span className="text-[11.5px] text-[var(--text-3)]">or</span>
          <span className="h-px flex-1 bg-[var(--border)]" />
        </div>

        <Button
          type="button"
          variant="secondary"
          size="lg"
          className="w-full"
          onClick={() => {
            window.location.href = '/api/auth/google/start';
          }}
        >
          <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" aria-hidden>
            <path fill="#4285F4" d="M23.5 12.27c0-.79-.07-1.54-.2-2.27H12v4.3h6.46a5.5 5.5 0 01-2.4 3.6v3h3.87c2.27-2.09 3.57-5.17 3.57-8.63z" />
            <path fill="#34A853" d="M12 24c3.24 0 5.96-1.08 7.94-2.91l-3.87-3c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.95H1.28v3.09A12 12 0 0012 24z" />
            <path fill="#FBBC05" d="M5.27 14.29a7.2 7.2 0 010-4.58V6.62H1.28a12 12 0 000 10.76l3.99-3.09z" />
            <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.43-3.43C17.95 1.19 15.24 0 12 0A12 12 0 001.28 6.62l3.99 3.09C6.22 6.86 8.87 4.75 12 4.75z" />
          </svg>
          Continue with Google
        </Button>
      </form>
    </AuthLayout>
  );
}
