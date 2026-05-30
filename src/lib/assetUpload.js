import { apiFetch } from './apiFetch.js';

export async function uploadAsset(file, type = 'image') {
  const form = new FormData();
  form.append('file', file);
  form.append('type', type);
  const res = await apiFetch('/api/assets/upload', { method: 'POST', body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Upload failed (${res.status})`);
  }
  return res.json(); // { url, assetId, key }
}
