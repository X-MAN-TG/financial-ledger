import { useEffect, useRef, useState } from 'react';
import { LIMITS } from '../../../shared/constants';
import type { LocalTransaction, NoteAttachment } from '../../../shared/types';
import { Button, Textarea } from '../../components/ui/primitives';
import { Modal } from '../../components/ui/overlays';

const MAX_IMAGES = 5;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

export function NoteSheet({ row, onClose, onSave }: { row: LocalTransaction | null; onClose: () => void; onSave: (note: string | null, attachments: NoteAttachment[]) => void }) {
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<NoteAttachment[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setDraft(row?.note ?? ''); setAttachments(row?.attachments ?? []); }, [row]);
  const addFiles = (files: FileList | null) => {
    if (!files) return;
    const available = MAX_IMAGES - attachments.length;
    Array.from(files).slice(0, available).forEach(file => {
      if (!file.type.startsWith('image/') || file.size > MAX_IMAGE_BYTES) return;
      const reader = new FileReader();
      reader.onload = () => setAttachments(prev => prev.length < MAX_IMAGES ? [...prev, { id: crypto.randomUUID(), name: file.name, type: file.type, dataUrl: String(reader.result) }] : prev);
      reader.readAsDataURL(file);
    });
  };
  const save = () => onSave(draft.trim() === '' ? null : draft.trim(), attachments);
  const remaining = LIMITS.noteMax - draft.length;
  return <Modal open={Boolean(row)} onClose={onClose} title={row?.customerNameSnapshot ? `Note · ${row.customerNameSnapshot}` : 'Note'} description={row ? `Row ${row.srNumber}` : undefined} footer={<>
    {(row?.note || attachments.length) && <Button variant="ghost" onClick={() => { setDraft(''); setAttachments([]); }} className="mr-auto">Clear note</Button>}
    <Button variant="ghost" onClick={onClose} data-close>Cancel</Button><Button variant="primary" onClick={save}>Save note</Button>
  </>}>
    <Textarea rows={6} value={draft} maxLength={LIMITS.noteMax} onChange={e => setDraft(e.target.value)} placeholder="Add context for this transaction…" aria-label="Note text" />
    <p className="mt-2 text-[12px] text-[var(--text-3)] text-right">{remaining} character{remaining === 1 ? '' : 's'} left</p>
    <div className="mt-4"><input ref={inputRef} type="file" accept="image/*" multiple className="hidden" onChange={e => addFiles(e.target.files)} />
      <Button variant="ghost" onClick={() => inputRef.current?.click()} disabled={attachments.length >= MAX_IMAGES}>📎 Attach images ({attachments.length}/{MAX_IMAGES})</Button>
      <div className="mt-3 grid grid-cols-5 gap-2">{attachments.map((image, i) => <div key={image.id} className="relative"><img src={image.dataUrl} alt={image.name} className="h-16 w-full rounded object-cover border border-[var(--border)]" /><button type="button" aria-label={`Remove ${image.name}`} onClick={() => setAttachments(a => a.filter((_, n) => n !== i))} className="absolute -right-1 -top-2 rounded-full bg-red-600 px-1.5 text-white">×</button></div>)}</div>
      <p className="mt-2 text-xs text-[var(--text-3)]">PNG, JPG, or WebP up to 6 MB each. Images stay with this note.</p>
    </div>
  </Modal>;
}
