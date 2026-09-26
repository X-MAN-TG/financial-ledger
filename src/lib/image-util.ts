import type { NoteAttachment } from '../../shared/types';

export const MAX_ATTACHMENTS = 5;
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024; // 5MB

/**
 * Compresses an image file client-side to ensure it stays crisp
 * while maintaining a compact size suitable for SQLite/D1 storage.
 */
export async function processImageFile(file: File): Promise<NoteAttachment> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Selected file is not an image');
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error('Image size must be less than 5MB');
  }

  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      try {
        const MAX_DIM = 1600;
        let width = img.naturalWidth || img.width;
        let height = img.naturalHeight || img.height;

        if (width > MAX_DIM || height > MAX_DIM) {
          if (width > height) {
            height = Math.round((height * MAX_DIM) / width);
            width = MAX_DIM;
          } else {
            width = Math.round((width * MAX_DIM) / height);
            height = MAX_DIM;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          throw new Error('Canvas context unavailable');
        }

        // Smooth image scaling
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);

        // Try webp first, fallback to jpeg
        let dataUrl = canvas.toDataURL('image/webp', 0.85);
        let mimeType = 'image/webp';
        if (!dataUrl.startsWith('data:image/webp')) {
          dataUrl = canvas.toDataURL('image/jpeg', 0.85);
          mimeType = 'image/jpeg';
        }

        resolve({
          id: crypto.randomUUID(),
          name: file.name,
          type: mimeType,
          dataUrl,
        });
      } catch (err) {
        reject(err);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load image'));
    };

    img.src = objectUrl;
  });
}

/**
 * Trigger browser download of an attachment
 */
export function downloadAttachment(attachment: NoteAttachment) {
  const link = document.createElement('a');
  link.href = attachment.dataUrl;
  link.download = attachment.name || `screenshot-${attachment.id}.webp`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
