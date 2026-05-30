// Color-key transparency. Some legacy PNG sprite/tile sheets don't ship
// real alpha — they use a solid color (magenta, black, cyan, etc.) as the
// "transparent" background. This module loads an image, optionally rewrites
// pixels matching a given color to alpha 0, and caches the resulting
// off-screen canvas so the masking cost is paid once per (src, color) pair.
//
// Returned value is always something `ctx.drawImage` can accept (an
// HTMLImageElement when no mask is needed, an HTMLCanvasElement otherwise).
// Both expose `width` and `height` so callers can read intrinsic size.

const cache = new Map(); // key = `${src}|${color}|${tol}` → { img, width, height }
const loading = new Map(); // promises in flight, deduped by key

function parseColor(input) {
  if (!input) return null;
  const s = String(input).trim();
  if (!s) return null;
  // Accept #rgb, #rgba, #rrggbb, #rrggbbaa
  if (s.startsWith('#')) {
    const hex = s.slice(1);
    if (hex.length === 3) {
      return { r: parseInt(hex[0] + hex[0], 16), g: parseInt(hex[1] + hex[1], 16), b: parseInt(hex[2] + hex[2], 16) };
    }
    if (hex.length === 6) {
      return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16) };
    }
  }
  // rgb()/rgba() also accepted
  const m = s.match(/rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (m) return { r: +m[1], g: +m[2], b: +m[3] };
  return null;
}

function maskCanvas(img, color, tolerance = 0) {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0);
  if (!color) return c;
  const rgb = parseColor(color);
  if (!rgb) return c;
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const px = data.data;
  const tol = Math.max(0, Math.min(255, tolerance | 0));
  for (let i = 0; i < px.length; i += 4) {
    if (
      Math.abs(px[i]     - rgb.r) <= tol &&
      Math.abs(px[i + 1] - rgb.g) <= tol &&
      Math.abs(px[i + 2] - rgb.b) <= tol
    ) {
      px[i + 3] = 0; // fully transparent
    }
  }
  ctx.putImageData(data, 0, 0);
  return c;
}

export function loadMaskedImage(src, transparentColor = null, tolerance = 0) {
  if (!src) return Promise.resolve(null);
  const key = `${src}|${transparentColor || ''}|${tolerance | 0}`;
  if (cache.has(key)) return Promise.resolve(cache.get(key));
  if (loading.has(key)) return loading.get(key);
  const p = new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const out = transparentColor ? maskCanvas(img, transparentColor, tolerance) : img;
        const entry = { img: out, width: img.width, height: img.height };
        cache.set(key, entry);
        loading.delete(key);
        resolve(entry);
      } catch (err) {
        loading.delete(key);
        reject(err);
      }
    };
    img.onerror = (e) => { loading.delete(key); reject(e); };
    img.src = src;
  });
  loading.set(key, p);
  return p;
}

// Read the RGB color of a single source pixel — used by the eyedropper UI
// to pick a color directly from a sheet image. Caches the raw image so
// repeated picks don't re-decode.
export function pickColorAt(src, sx, sy) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      try {
        const px = ctx.getImageData(Math.floor(sx), Math.floor(sy), 1, 1).data;
        resolve('#' + [px[0], px[1], px[2]].map(v => v.toString(16).padStart(2, '0')).join(''));
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = reject;
    img.src = src;
  });
}
