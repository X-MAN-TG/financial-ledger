import { forwardRef, useState } from 'react';
import { Input, type InputProps } from '../../components/ui/primitives';

export const PasswordInput = forwardRef<HTMLInputElement, InputProps>(function PasswordInput(
  props,
  ref,
) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input ref={ref} type={visible ? 'text' : 'password'} className="pr-11" {...props} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        tabIndex={-1}
        className="absolute right-0 top-0 h-11 w-11 grid place-items-center text-[var(--text-3)] hover:text-[var(--text-1)] transition-colors"
      >
        {visible ? (
          <svg viewBox="0 0 24 24" className="h-[17px] w-[17px]" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
            <path d="M3 3l18 18M10.6 10.7a2 2 0 002.8 2.8M9.4 5.3A9.7 9.7 0 0112 5c5 0 9 4.5 9 7a11 11 0 01-2.6 3.6M6.2 6.7A11.4 11.4 0 003 12c0 2.5 4 7 9 7a9.6 9.6 0 003.9-.8" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="h-[17px] w-[17px]" fill="none" stroke="currentColor" strokeWidth="1.7">
            <path d="M3 12s3.6-7 9-7 9 7 9 7-3.6 7-9 7-9-7-9-7z" />
            <circle cx="12" cy="12" r="2.6" />
          </svg>
        )}
      </button>
    </div>
  );
});
