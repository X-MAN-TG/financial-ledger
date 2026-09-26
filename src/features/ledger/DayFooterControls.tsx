import { useEffect, useState, type ChangeEvent } from 'react';
import type { LocalLedgerDay, NoteAttachment } from '../../../shared/types';
import { Button, Input } from '../../components/ui/primitives';
import { ImageLightbox } from '../../components/ui/ImageLightbox';
import { cn } from '../../lib/cn';

interface DayFooterControlsProps {
  day: LocalLedgerDay | null;
  readOnly?: boolean;
  onUpdateUsdtRate: (rate: number) => void;
  onOpenDayNote: () => void;
}

export function DayFooterControls({
  day,
  readOnly = false,
  onUpdateUsdtRate,
  onOpenDayNote,
}: DayFooterControlsProps) {
  const currentRate = day?.usdtRate ?? 0;
  const [rateInput, setRateInput] = useState<string>(
    currentRate === 0 ? '0' : String(currentRate),
  );
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  useEffect(() => {
    const val = day?.usdtRate ?? 0;
    setRateInput(val === 0 ? '0' : String(val));
  }, [day?.usdtRate]);

  const handleRateChange = (e: ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setRateInput(val);
  };

  const handleBlurOrCommit = () => {
    const trimmed = rateInput.trim();
    const parsed = trimmed === '' ? 0 : Number(trimmed);
    const safeRate = isNaN(parsed) || parsed < 0 ? 0 : parsed;
    setRateInput(safeRate === 0 ? '0' : String(safeRate));
    if (safeRate !== (day?.usdtRate ?? 0)) {
      onUpdateUsdtRate(safeRate);
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 2000);
    }
  };

  const hasDayNote = Boolean(day?.note && day.note.trim());
  const attachments: NoteAttachment[] = day?.attachments ?? [];
  const hasAttachments = attachments.length > 0;
  const rateDisplay = rateInput.trim() !== '' ? rateInput.trim() : '0';

  return (
    <>
      <div className="mt-4 grid grid-cols-1 md:grid-cols-12 gap-3 no-print">
        {/* USDT Rate Box */}
        <div className="md:col-span-4 lg:col-span-3 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-1)] p-3.5 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-bold">
                  $
                </span>
                <label
                  htmlFor="day-usdt-rate"
                  className="text-xs font-semibold uppercase tracking-wider text-[var(--text-1)]"
                >
                  USDT Rate
                </label>
              </div>
              {savedSuccess && (
                <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400 animate-fade-in">
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Saved
                </span>
              )}
            </div>
            <p className="mt-1 text-[11.5px] text-[var(--text-3)] leading-tight">
              Rate received for today&apos;s USDT trades.
            </p>
          </div>

          <div className="mt-3">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-[var(--text-3)]">
                ₹
              </span>
              <Input
                id="day-usdt-rate"
                type="number"
                step="any"
                min="0"
                disabled={readOnly}
                value={rateInput}
                onChange={handleRateChange}
                onBlur={handleBlurOrCommit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.currentTarget.blur();
                  }
                }}
                placeholder="0"
                aria-label="Today's USDT rate"
                className={cn(
                  'pl-7 pr-3 h-10 text-[15px] font-semibold tracking-tight num',
                  'bg-[var(--surface-2)] border-[var(--border)] focus:bg-[var(--surface-1)]',
                )}
              />
            </div>

            {/* Exactly formatted as user requested: 1$ = 101, 102 etc. */}
            <div className="mt-2 flex items-center justify-between text-[11.5px] border-t border-[var(--border)] pt-1.5">
              <span className="text-[var(--text-3)]">Unit rate:</span>
              <span className="font-semibold text-[var(--text-1)] num font-mono">
                1$ = ₹{rateDisplay}
              </span>
            </div>
          </div>
        </div>

        {/* Common Day Note & Media Box */}
        <div className="md:col-span-8 lg:col-span-9 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-1)] p-3.5 shadow-sm flex flex-col justify-between">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4 text-[var(--accent)] shrink-0"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-1)]">
                Day Note &amp; Closing Media
              </span>
              {(hasDayNote || hasAttachments) && (
                <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[10.5px] font-semibold text-[var(--accent)]">
                  Active
                </span>
              )}
            </div>

            <Button
              size="sm"
              variant={hasDayNote || hasAttachments ? 'secondary' : 'subtle'}
              onClick={onOpenDayNote}
              className="h-8 text-xs px-3"
            >
              {hasDayNote || hasAttachments ? (
                <>
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 mr-1.5" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M11 4H4a2 2 0 00-2 2v16a2 2 0 002 2h14a2 2 0 002-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                  Edit day note
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 mr-1.5" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  Add closing note / media
                </>
              )}
            </Button>
          </div>

          {/* Content area: note text + attached screenshots preview */}
          <div
            onClick={onOpenDayNote}
            className="mt-2.5 rounded-md border border-dashed border-[var(--border)] bg-[var(--surface-2)]/60 hover:bg-[var(--surface-2)] p-2.5 cursor-pointer transition-colors"
          >
            {hasDayNote || hasAttachments ? (
              <div className="space-y-2">
                {hasDayNote && (
                  <p className="text-[13px] text-[var(--text-1)] line-clamp-2 leading-relaxed whitespace-pre-wrap">
                    {day?.note}
                  </p>
                )}

                {hasAttachments && (
                  <div className="flex items-center gap-2 pt-1 border-t border-[var(--border)]">
                    <span className="text-[11px] font-semibold text-[var(--text-3)] shrink-0">
                      📎 {attachments.length} screenshot{attachments.length === 1 ? '' : 's'}:
                    </span>
                    <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
                      {attachments.map((img, i) => (
                        <button
                          key={img.id}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPreviewIndex(i);
                          }}
                          className="h-10 w-10 rounded-md overflow-hidden border border-[var(--border)] shrink-0 hover:border-[var(--accent)] hover:opacity-90 transition-all cursor-pointer focus:outline-none"
                          title={`Click to view ${img.name || 'screenshot'}`}
                        >
                          <img
                            src={img.dataUrl}
                            alt={img.name}
                            className="h-full w-full object-cover pointer-events-none"
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-[var(--text-3)] text-center sm:text-left py-1">
                No day note or closing screenshots yet. Click here to add day closing notes, handover remarks, or attach proof media.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Lightbox for direct viewing from the day footer */}
      <ImageLightbox
        open={previewIndex !== null}
        images={attachments}
        initialIndex={previewIndex ?? 0}
        onClose={() => setPreviewIndex(null)}
      />
    </>
  );
}
