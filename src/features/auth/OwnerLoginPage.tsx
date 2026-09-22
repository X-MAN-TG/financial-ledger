/**
 * Owner sign-in - a completely separate path from user auth (04 s3).
 * The Worker rejects OWNER credentials at /api/auth/login and USER
 * credentials here, so the two surfaces can never be confused.
 */
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate } from 'react-router-dom';
import { ownerLoginSchema, type OwnerLoginInput } from '../../../shared/validation';
import { ApiError, apiPost } from '../../lib/api';
import { Button, FieldError, Input, Label } from '../../components/ui/primitives';
import { useSession } from '../../hooks/use-session';
import { AuthLayout } from './AuthLayout';
import { PasswordInput } from './PasswordInput';

export function OwnerLoginPage() {
  const navigate = useNavigate();
  const { refresh } = useSession();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<OwnerLoginInput>({ resolver: zodResolver(ownerLoginSchema), mode: 'onBlur' });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await apiPost('/api/owner/login', values);
      await refresh();
      navigate('/owner', { replace: true });
    } catch (e) {
      if (e instanceof ApiError) {
        setFormError(
          e.status === 429
            ? 'Too many attempts. Please wait before trying again.'
            : e.message,
        );
      } else {
        setFormError('Could not sign in.');
      }
    }
  });

  return (
    <AuthLayout
      badge="Owner"
      title="Owner sign-in"
      subtitle="Administrative access to system health, users, columns and audit."
      footer={
        <Link to="/login" className="text-[var(--text-3)] hover:text-[var(--text-2)] hover:underline text-[12px]">
          Back to user sign-in
        </Link>
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
          <Label htmlFor="owner-email" required>Owner email</Label>
          <Input
            id="owner-email"
            type="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            invalid={Boolean(errors.email)}
            {...register('email')}
          />
          <FieldError>{errors.email?.message}</FieldError>
        </div>

        <div>
          <Label htmlFor="owner-password" required>Password</Label>
          <PasswordInput
            id="owner-password"
            autoComplete="current-password"
            invalid={Boolean(errors.password)}
            {...register('password')}
          />
          <FieldError>{errors.password?.message}</FieldError>
        </div>

        <Button type="submit" variant="primary" size="lg" className="w-full" loading={isSubmitting}>
          Sign in as owner
        </Button>

        <p className="text-[11.5px] text-[var(--text-3)] leading-relaxed pt-1">
          All owner actions are recorded in the global audit log.
        </p>
      </form>
    </AuthLayout>
  );
}
