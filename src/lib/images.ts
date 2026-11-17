import { supabase } from './supabase';

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
export const ACCEPT_ATTR = ACCEPTED.join(',');

export function validateImage(file: File): string | null {
  if (!ACCEPTED.includes(file.type)) return 'Please choose a JPG, PNG, WebP or GIF image.';
  if (file.size > 20 * 1024 * 1024) return 'That image is too large (20 MB max).';
  return null;
}

/**
 * Shrinks a photo in the browser before upload so it loads fast for
 * everyone. GIFs are left alone so animation is kept.
 */
export async function compressImage(file: File, maxSide = 1600, quality = 0.85): Promise<Blob> {
  if (file.type === 'image/gif') return file;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
  return blob && blob.size < file.size ? blob : file;
}

function extensionFor(blob: Blob) {
  if (blob.type === 'image/webp') return 'webp';
  if (blob.type === 'image/png') return 'png';
  if (blob.type === 'image/gif') return 'gif';
  return 'jpg';
}

/** Uploads to the public "media" bucket and returns the storage path and public URL. */
export async function uploadMedia(folder: string, file: File, maxSide = 1600) {
  const blob = await compressImage(file, maxSide);
  const path = `${folder}/${crypto.randomUUID()}.${extensionFor(blob)}`;
  const { error } = await supabase.storage.from('media').upload(path, blob, {
    contentType: blob.type || file.type,
    cacheControl: '31536000',
  });
  if (error) throw error;
  const { data } = supabase.storage.from('media').getPublicUrl(path);
  return { path, url: data.publicUrl };
}

export async function removeMedia(path: string) {
  await supabase.storage.from('media').remove([path]);
}

/** Pulls the storage path back out of a public media URL. */
export function mediaPathFromUrl(url: string | null | undefined) {
  if (!url) return null;
  const marker = '/storage/v1/object/public/media/';
  const i = url.indexOf(marker);
  return i === -1 ? null : decodeURIComponent(url.slice(i + marker.length));
}

/** Makes a tiny, blurred JPEG (as a data URL) for private photo previews. */
export async function makeBlurPreview(file: File): Promise<string | null> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return null;
  const scale = 20 / Math.max(bitmap.width, bitmap.height);
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.filter = 'blur(1.5px)';
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const url = canvas.toDataURL('image/jpeg', 0.5);
  return url.length <= 6000 ? url : null;
}

/** Uploads a picture sent in a chat to the private "chat-images" bucket. */
export async function uploadChatImage(conversationId: string, file: File, privateTo?: { recipient: string; sender: string }) {
  const blob = await compressImage(file, 2000);
  const folder = privateTo ? `${conversationId}/private/${privateTo.recipient}/${privateTo.sender}` : conversationId;
  const path = `${folder}/${crypto.randomUUID()}.${extensionFor(blob)}`;
  const { error } = await supabase.storage.from('chat-images').upload(path, blob, {
    contentType: blob.type || file.type,
  });
  if (error) throw error;
  return path;
}

// Chat pictures are private, so we fetch short-lived signed links and cache them.
const signedCache = new Map<string, { url: string; expires: number }>();
const inflight = new Map<string, Promise<string | null>>();

export async function getChatImageUrl(path: string): Promise<string | null> {
  const hit = signedCache.get(path);
  if (hit && hit.expires > Date.now()) return hit.url;
  const existing = inflight.get(path);
  if (existing) return existing;
  const p = supabase.storage
    .from('chat-images')
    .createSignedUrl(path, 60 * 60)
    .then(({ data }) => {
      inflight.delete(path);
      if (!data?.signedUrl) return null;
      signedCache.set(path, { url: data.signedUrl, expires: Date.now() + 55 * 60 * 1000 });
      return data.signedUrl;
    });
  inflight.set(path, p);
  return p;
}
