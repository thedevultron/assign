// Session token lives in localStorage and is sent as a Bearer header.
// (Cookies are unreliable inside cross-site preview iframes.)
const KEY = 'assign:session';
export const session = {
  get: () => { try { return localStorage.getItem(KEY); } catch { return null; } },
  set: (t) => { try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); } catch {} },
};

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

const TIMEOUT_MS = 12000;
async function req(method, url, body) {
  const token = session.get();
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  let res;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    res = await fetch('/api' + url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal: ac.signal });
  } catch (e) {
    clearTimeout(timer);
    const err = new Error(e?.name === 'AbortError' ? 'The server is taking too long — it might be restarting' : 'Can’t reach the server — check your connection');
    err.status = 0; throw err;
  }
  clearTimeout(timer);
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (res.status === 401 && data?.code === 'unauthenticated') onUnauthorized();
  if (!res.ok) { const e = new Error(data?.error || `Request failed (${res.status})`); e.status = res.status; throw e; }
  return data;
}

export const api = {
  get: (u) => req('GET', u),
  post: (u, b = {}) => req('POST', u, b),
  patch: (u, b) => req('PATCH', u, b),
  put: (u, b) => req('PUT', u, b),
  del: (u, b) => req('DELETE', u, b),
  async download(url, filename) {
    const token = session.get();
    const res = await fetch(url.startsWith('/') ? url : '/api' + url, { headers: token ? { authorization: `Bearer ${token}` } : {} });
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  },
};
