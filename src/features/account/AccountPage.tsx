/**
 * Account surface: Profile, Backup Center, Trash, Activity.
 * Covers 14 section 2 (user backup center) and 12 (audit visible to user).
 */
import { useState } from 'react';
import { cn } from '../../lib/cn';
import { Page } from '../../components/AppShell';
import { ProfileTab } from './ProfileTab';
import { BackupTab } from './BackupTab';
import { TrashTab } from './TrashTab';
import { ActivityTab } from './ActivityTab';

type Tab = 'profile' | 'backup' | 'trash' | 'activity';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'profile', label: 'Profile' },
  { id: 'backup', label: 'Backup' },
  { id: 'trash', label: 'Trash' },
  { id: 'activity', label: 'Activity' },
];

export function AccountPage() {
  const [tab, setTab] = useState<Tab>('profile');

  return (
    <Page title="Account">
      <div className="flex gap-1 p-1 rounded-md bg-[var(--surface-2)] border border-[var(--border)] mb-4 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              'h-9 px-3.5 rounded text-[12.5px] font-medium transition-colors whitespace-nowrap shrink-0',
              tab === t.id
                ? 'bg-[var(--surface-1)] text-[var(--text-1)] shadow-e1'
                : 'text-[var(--text-3)] hover:text-[var(--text-2)]',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'profile' && <ProfileTab />}
      {tab === 'backup' && <BackupTab />}
      {tab === 'trash' && <TrashTab />}
      {tab === 'activity' && <ActivityTab />}
    </Page>
  );
}
