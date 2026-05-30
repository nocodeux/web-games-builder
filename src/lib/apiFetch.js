const TOKEN_KEY = 'tuify_token';

export function getToken() { return localStorage.getItem(TOKEN_KEY); }
export function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
export function clearToken() { localStorage.removeItem(TOKEN_KEY); }

export async function apiFetch(url, opts = {}) {
  const token = getToken();
  const headers = { ...opts.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(url, { ...opts, headers });

  if (res.status === 401) {
    clearToken();
    window.dispatchEvent(new CustomEvent('tuify:auth-required'));
    throw new Error('Authentication required');
  }

  return res;
}
