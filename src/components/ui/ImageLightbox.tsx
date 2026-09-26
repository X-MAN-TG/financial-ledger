import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { NoteAttachment } from '../../../shared/types';
import { downloadAttachment } from '../../lib/image-util';

export function ImageLightbox({
  open,
  images,
  initialIndex = 0,
  onClose,
  onDelete,
}: {
  open: boolean;
  images: NoteAttachment[];
  initialIndex?: number;
  onClose: () => void;
  onDelete?: (id: string) => void;
}) {
  const [index, setIndex] = useState(initialIndex);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setIndex(initialIndex);
    setConfirmDelete(false);
  }, [initialIndex, open]);

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      } else if (e.key === 'ArrowLeft') {
        e.stopPropagation();
        setConfirmDelete(false);
        setIndex((prev) => (prev > 0 ? prev - 1 : images.length - 1));
      } else if (e.key === 'ArrowRight') {
        e.stopPropagation();
        setConfirmDelete(false);
        setIndex((prev) => (prev < images.length - 1 ? prev + 1 : 0));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, images.length, onClose]);

  if (!open || images.length === 0) return null;

  const current = images[index] || images[0];

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex flex-col items-center justify-between bg-black/95 p-3 sm:p-5 select-none animate-fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Image preview"
    >
      {/* Top Bar */}
      <div
        className="w-full max-w-5xl flex items-center justify-between pb-3 text-white/90 z-10 shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 truncate pr-4">
          <span className="text-sm font-semibold truncate text-white">{current.name || 'Screenshot'}</span>
          {images.length > 1 && (
            <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-medium text-white/90">
              {index + 1} / {images.length}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => downloadAttachment(current)}
            className="flex items-center gap-1.5 rounded-lg bg-white/10 hover:bg-white/20 px-3 py-1.5 text-xs font-medium text-white transition-colors"
            title="Download image"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="hidden sm:inline">Download</span>
          </button>

          {onDelete && (
            confirmDelete ? (
              <div className="flex items-center gap-1.5 animate-fade-in">
                <span className="text-xs text-red-300 font-medium hidden sm:inline">Delete?</span>
                <button
                  type="button"
                  onClick={() => {
                    const toDeleteId = current.id;
                    setConfirmDelete(false);
                    onDelete(toDeleteId);
                    if (images.length <= 1) {
                      onClose();
                    } else if (index >= images.length - 1) {
                      setIndex(images.length - 2);
                    }
                  }}
                  className="rounded-lg bg-red-600 hover:bg-red-700 px-3 py-1.5 text-xs font-semibold text-white shadow transition-colors"
                >
                  Yes, delete
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="rounded-lg bg-white/10 hover:bg-white/20 px-2.5 py-1.5 text-xs font-medium text-white transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="flex items-center gap-1.5 rounded-lg bg-red-600/80 hover:bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors"
                title="Delete screenshot"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="hidden sm:inline">Delete</span>
              </button>
            )
          )}

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-white/10 hover:bg-white/25 p-1.5 text-white transition-colors ml-1"
            title="Close (Esc)"
            aria-label="Close"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>

      {/* Main Image Container */}
      <div
        className="relative flex flex-1 items-center justify-center w-full max-w-6xl overflow-hidden my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {images.length > 1 && (
          <button
            type="button"
            onClick={() => {
              setConfirmDelete(false);
              setIndex((prev) => (prev > 0 ? prev - 1 : images.length - 1));
            }}
            className="absolute left-2 sm:left-4 z-20 rounded-full bg-black/70 hover:bg-black p-3 text-white shadow-lg transition-transform hover:scale-110 active:scale-95"
            aria-label="Previous image"
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}

        <img
          src={current.dataUrl}
          alt={current.name || 'Screenshot preview'}
          className="max-h-[78vh] sm:max-h-[82vh] max-w-full rounded-lg object-contain shadow-2xl transition-all"
        />

        {images.length > 1 && (
          <button
            type="button"
            onClick={() => {
              setConfirmDelete(false);
              setIndex((prev) => (prev < images.length - 1 ? prev + 1 : 0));
            }}
            className="absolute right-2 sm:right-4 z-20 rounded-full bg-black/70 hover:bg-black p-3 text-white shadow-lg transition-transform hover:scale-110 active:scale-95"
            aria-label="Next image"
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </div>

      {/* Thumbnails strip below if multiple images */}
      {images.length > 1 ? (
        <div
          className="mt-3 flex items-center justify-center gap-2 overflow-x-auto p-1.5 max-w-full z-10 shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          {images.map((img, i) => (
            <button
              key={img.id}
              type="button"
              onClick={() => {
                setConfirmDelete(false);
                setIndex(i);
              }}
              className={`relative h-12 w-12 sm:h-14 sm:w-14 rounded-md border-2 overflow-hidden transition-all shrink-0 ${
                i === index
                  ? 'border-[var(--accent)] ring-2 ring-[var(--accent)] scale-105 opacity-100'
                  : 'border-white/20 opacity-60 hover:opacity-100'
              }`}
            >
              <img src={img.dataUrl} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      ) : (
        <div className="h-3 shrink-0" />
      )}
    </div>,
    document.body,
  );
}
