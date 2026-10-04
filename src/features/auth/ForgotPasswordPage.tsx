import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate } from 'react-router-dom';
import { resetPasswordSchema, type ResetPasswordInput } from '../../../shared/validation';
import { ApiError, apiPost } from '../../lib/api';
import { Button, FieldError, Hint, Input, Label } from '../../components/ui/primitives';
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

export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    mode: 'onBlur',
  });

  const pw = watch('password') ?? '';
  const s = strength(pw);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await apiPost('/api/auth/reset-password', {
        email: values.email,
        password: values.password,
      });
      setSuccess(true);
    } catch (e) {
      if (e instanceof ApiError) {
        setFormError(e.message || 'Could not reset password. Please check your email and try again.');
      } else {
        setFormError('Could not reset password. Please check your connection and try again.');
      }
    }
  });

  if (success) {
    const email = getValues('email');
    return (
      <AuthLayout
        title="Password updated"
        subtitle="Your password has been changed successfully."
        footer={
          <p className="text-[13px]">
            <Link to="/login" className="text-[var(--accent)] font-medium hover:underline">
              Return to sign in
            </Link>
          </p>
        }
      >
        <div className="space-y-4">
          <div
            role="status"
            className="rounded-md px-3.5 py-3 text-[13px] leading-relaxed"
            style={{ background: 'var(--success-soft)', color: 'var(--success)' }}
          >
            Your password has been reset. You can now use your new password to sign into your account.
          </div>

          <Button
            type="button"
            variant="primary"
            size="lg"
            className="w-full"
            onClick={() => navigate('/login', { state: { email } })}
          >
            Sign in now
          </Button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Reset password"
      subtitle="Enter your account email and choose a new password."
      footer={
        <div className="space-y-2">
          <p>
            Remember your password?{' '}
            <Link to="/login" className="text-[var(--accent)] font-medium hover:underline">
              Sign in
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
          <Label htmlFor="email" required>
            Account Email
          </Label>
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
          <Label htmlFor="password" required>
            New Password
          </Label>
          <PasswordInput
            id="password"
            autoComplete="new-password"
            invalid={Boolean(errors.password)}
            {...register('password')}
          />
          {pw && (
            <div className="mt-1.5 flex items-center gap-2">
              <div className="h-1 flex-1 bg-[var(--surface-3)] rounded-full overflow-hidden">
                <div
                  className="h-full transition-all duration-300 rounded-full"
                  style={{
                    width: `${((s.score + 1) / 6) * 100}%`,
                    background:
                      s.score <= 1
                        ? 'var(--danger)'
                        : s.score <= 3
                          ? 'var(--warning)'
                          : 'var(--success)',
                  }}
                />
              </div>
              <span className="text-[11.5px] text-[var(--text-3)]">{s.label}</span>
            </div>
          )}
          <Hint>Must be at least 8 characters.</Hint>
          <FieldError>{errors.password?.message}</FieldError>
        </div>

        <div>
          <Label htmlFor="confirmPassword" required>
            Confirm New Password
          </Label>
          <PasswordInput
            id="confirmPassword"
            autoComplete="new-password"
            invalid={Boolean(errors.confirmPassword)}
            {...register('confirmPassword')}
          />
          <FieldError>{errors.confirmPassword?.message}</FieldError>
        </div>

        <Button type="submit" variant="primary" size="lg" className="w-full" loading={isSubmitting}>
          Update password
        </Button>
      </form>
    </AuthLayout>
  );
}
