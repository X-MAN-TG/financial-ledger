import { useEffect, useRef, useState } from 'react';
import { LIMITS } from '../../../shared/constants';
import type { LocalTransaction, NoteAttachment } from '../../../shared/types';
import { Button, Textarea } from '../../components/ui/primitives';
import { Modal } from '../../components/ui/overlays';
import { ImageLightbox } from '../../components/ui/ImageLightbox';
import { MAX_ATTACHMENTS, processImageFile } from '../../lib/image-util';

export interface NoteSheetProps {
  /** If provided, sets title and loads data from transaction row */
  row?: LocalTransaction | null;
  /** Explicit open flag when not using row */
  open?: boolean;
  title?: string;
  description?: string;
  placeholder?: string;
  initialNote?: string | null;
  initialAttachments?: NoteAttachment[];
  onClose: () => void;
  onSave: (note: string | null, attachments: NoteAttachment[]) => void;
}

export function NoteSheet({
  row,
  open: explicitOpen,
  title: explicitTitle,
  description: explicitDescription,
  placeholder,
  initialNote,
  initialAttachments,
  onClose,
  onSave,
}: NoteSheetProps) {
  const isOpen = row !== undefined ? Boolean(row) : Boolean(explicitOpen);

  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<NoteAttachment[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
  const [processing, setProcessing] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (row) {
      setDraft(row.note ?? '');
      setAttachments(row.attachments ?? []);
    } else {
      setDraft(initialNote ?? '');
      setAttachments(initialAttachments ?? []);
    }
    setUploadError(null);
    setLightboxIndex(null);
    setPendingDelete(null);
  }, [row, initialNote, initialAttachments, isOpen]);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadError(null);
    const available = MAX_ATTACHMENTS - attachments.length;
    if (available <= 0) {
      setUploadError(`Maximum ${MAX_ATTACHMENTS} screenshots allowed`);
      return;
    }

    const filesToProcess = Array.from(files).slice(0, available);
    setProcessing(true);

    try {
      const processed: NoteAttachment[] = [];
      for (const file of filesToProcess) {
        if (!file.type.startsWith('image/')) {
          setUploadError('Only image files (PNG, JPG, WebP) are supported');
          continue;
        }
        if (file.size > 5 * 1024 * 1024) {
          setUploadError('Images must be smaller than 5MB');
          continue;
        }
        const item = await processImageFile(file);
        processed.push(item);
      }

      setAttachments((prev) => [...prev, ...processed].slice(0, MAX_ATTACHMENTS));
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Could not process image');
    } finally {
      setProcessing(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const handleRemoveAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
    if (pendingDelete?.id === id) {
      setPendingDelete(null);
    }
  };

  const save = () => {
    onSave(draft.trim() === '' ? null : draft.trim(), attachments);
  };

  const modalTitle =
    explicitTitle ??
    (row?.customerNameSnapshot ? `Note · ${row.customerNameSnapshot}` : 'Transaction Note');
  const modalDescription =
    explicitDescription ?? (row ? `Row ${row.srNumber}` : undefined);
  const remaining = LIMITS.noteMax - draft.length;

  return (
    <>
      <Modal
        open={isOpen}
        onClose={onClose}
        title={modalTitle}
        description={modalDescription}
        size="md"
        footer={
          <>
            {(draft.length > 0 || attachments.length > 0) && (
              <Button
                variant="ghost"
                onClick={() => {
                  setDraft('');
                  setAttachments([]);
                }}
                className="mr-auto text-[var(--text-3)] hover:text-[var(--danger)]"
              >
                Clear all
              </Button>
            )}
            <Button variant="ghost" onClick={onClose} data-close>
              Cancel
            </Button>
            <Button variant="primary" onClick={save} disabled={processing}>
              Save note
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <Textarea
              rows={5}
              value={draft}
              maxLength={LIMITS.noteMax}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={placeholder ?? 'Add details, transaction context, or closing remarks…'}
              aria-label="Note text"
              className="resize-none"
            />
            <div className="mt-1.5 flex items-center justify-between text-[11.5px] text-[var(--text-3)]">
              <span>Supports up to {MAX_ATTACHMENTS} screenshots/media</span>
              <span className={remaining < 50 ? 'text-[var(--warning)] font-medium' : ''}>
                {remaining} character{remaining === 1 ? '' : 's'} left
              </span>
            </div>
          </div>

          {/* Media Attachments Section */}
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-2)]">
                  Screenshots & Media
                </span>
                <span className="rounded-full bg-[var(--surface-3)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-2)]">
                  {attachments.length}/{MAX_ATTACHMENTS}
                </span>
              </div>

              <input
                ref={inputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => void handleFiles(e.target.files)}
              />

              <Button
                size="sm"
                variant="secondary"
                disabled={attachments.length >= MAX_ATTACHMENTS || processing}
                loading={processing}
                onClick={() => inputRef.current?.click()}
                className="text-xs h-8 px-2.5"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-3.5 w-3.5 mr-1"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                >
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                </svg>
                Attach image
              </Button>
            </div>

            {uploadError && (
              <p className="mt-2 text-xs text-[var(--danger)] font-medium">{uploadError}</p>
            )}

            {/* Attachments preview gallery (clean, without edit x marks; long hold to remove) */}
            {attachments.length > 0 ? (
              <div className="mt-3">
                <div className="grid grid-cols-5 gap-2.5">
                  {attachments.map((img, i) => (
                    <ThumbnailItem
                      key={img.id}
                      img={img}
                      index={i}
                      onOpen={(idx) => setLightboxIndex(idx)}
                      onPromptDelete={(id, name) => setPendingDelete({ id, name })}
                    />
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-[var(--text-3)] text-center sm:text-left">
                  Tap to view full screen • Press &amp; hold to remove
                </p>
              </div>
            ) : (
              <div
                onClick={() => inputRef.current?.click()}
                className="mt-2.5 rounded border border-dashed border-[var(--border)] p-3 text-center cursor-pointer hover:bg-[var(--surface-3)]/50 transition-colors"
              >
                <p className="text-xs text-[var(--text-3)]">
                  Attach up to 5 screenshots (less than 5MB each). Click to browse or upload.
                </p>
              </div>
            )}
          </div>
        </div>
      </Modal>

      {/* Confirmation dialog when an image is held / long-pressed to remove */}
      {pendingDelete && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-fade-in"
          onClick={() => setPendingDelete(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-xs rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-4 shadow-xl text-center animate-fade-rise"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-red-500/10 text-red-600 mb-2.5">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h3 className="text-sm font-semibold text-[var(--text-1)]">Remove screenshot?</h3>
            <p className="mt-1 text-xs text-[var(--text-3)] truncate">
              {pendingDelete.name || 'This screenshot'}
            </p>
            <div className="mt-4 flex items-center justify-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setPendingDelete(null)}
                className="text-xs flex-1"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => handleRemoveAttachment(pendingDelete.id)}
                className="text-xs flex-1 font-semibold"
              >
                Remove
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox Modal for Full Resolution Preview & Management */}
      <ImageLightbox
        open={lightboxIndex !== null}
        images={attachments}
        initialIndex={lightboxIndex ?? 0}
        onClose={() => setLightboxIndex(null)}
        onDelete={handleRemoveAttachment}
      />
    </>
  );
}

function ThumbnailItem({
  img,
  index,
  onOpen,
  onPromptDelete,
}: {
  img: NoteAttachment;
  index: number;
  onOpen: (index: number) => void;
  onPromptDelete: (id: string, name: string) => void;
}) {
  const timerRef = useRef<number | null>(null);
  const isLongPressRef = useRef(false);

  const startPress = () => {
    isLongPressRef.current = false;
    timerRef.current = window.setTimeout(() => {
      isLongPressRef.current = true;
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate?.(50);
      }
      onPromptDelete(img.id, img.name);
    }, 500);
  };

  const endPress = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const handleClick = (e: React.MouseEvent) => {
    if (isLongPressRef.current) {
      e.preventDefault();
      e.stopPropagation();
      isLongPressRef.current = false;
      return;
    }
    onOpen(index);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    onPromptDelete(img.id, img.name);
  };

  return (
    <div
      className="group relative aspect-square rounded-md overflow-hidden border border-[var(--border)] bg-[var(--surface-1)] shadow-sm cursor-pointer select-none transition-all hover:border-[var(--accent)] hover:shadow-md"
      onPointerDown={startPress}
      onPointerUp={endPress}
      onPointerCancel={endPress}
      onContextMenu={handleContextMenu}
      onClick={handleClick}
      title="Tap to preview • Press and hold to remove"
    >
      <img
        src={img.dataUrl}
        alt={img.name}
        className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105 pointer-events-none"
      />
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/25 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
        <svg
          viewBox="0 0 24 24"
          className="h-5 w-5 text-white drop-shadow"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}
