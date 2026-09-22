/**
 * Note editor. Bottom sheet on mobile, dialog on desktop (18 s2.3).
 * Opens over the table rather than expanding the row (16 s7.5).
 */
import { useEffect, useState } from 'react';
import { LIMITS } from '../../../shared/constants';
import type { LocalTransaction } from '../../../shared/types';
import { Button, Textarea } from '../../components/ui/primitives';
import { Modal } from '../../components/ui/overlays';

export function NoteSheet({
  row,
  onClose,
  onSave,
}: {
  row: LocalTransaction | null;
  onClose: () => void;
  onSave: (note: string | null) => void;
}) {
  const [draft, setDraft] = useState('');

  useEffect(() => {
    setDraft(row?.note ?? '');
  }, [row]);

  const remaining = LIMITS.noteMax - draft.length;

  return (
    <Modal
      open={Boolean(row)}
      onClose={onClose}
      title={row?.customerNameSnapshot ? `Note · ${row.customerNameSnapshot}` : 'Note'}
      description={row ? `Row ${row.srNumber}` : undefined}
      footer={
        <>
          {row?.note && (
            <Button variant="ghost" onClick={() => onSave(null)} className="mr-auto">
              Clear note
            </Button>
          )}
          <Button variant="ghost" onClick={onClose} data-close>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => onSave(draft.trim() === '' ? null : draft.trim())}
          >
            Save note
          </Button>
        </>
      }
    >
      <Textarea
        rows={6}
        value={draft}
        maxLength={LIMITS.noteMax}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Add context for this transaction…"
        aria-label="Note text"
      />
      <p className="mt-2 text-[12px] text-[var(--text-3)] text-right">
        {remaining} character{remaining === 1 ? '' : 's'} left
      </p>
    </Modal>
  );
}
