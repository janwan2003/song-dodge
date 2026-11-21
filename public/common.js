// Shared helpers: API calls with the player's token, local storage of joined games, toasts, share/copy.
export const $ = (s, el = document) => el.querySelector(s);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LOCAL = /^(127\.0\.0\.1|localhost)$/.test(location.hostname);

export const tokenFor = (id) => localStorage.getItem('sd:tok:' + id);
export function saveGame(id, token, title) {
  localStorage.setItem('sd:tok:' + id, token);
  const list = myGames().filter((g) => g.id !== id);
  list.unshift({ id, title, at: Date.now() });
  localStorage.setItem('sd:games', JSON.stringify(list.slice(0, 20)));
}
export function forgetGame(id) {
  localStorage.removeItem('sd:tok:' + id);
  localStorage.setItem('sd:games', JSON.stringify(myGames().filter((g) => g.id !== id)));
}
export function myGames() {
  try { return JSON.parse(localStorage.getItem('sd:games') || '[]'); } catch { return []; }
}

export async function api(path, { method = 'GET', body, id } = {}) {
  const headers = { 'content-type': 'application/json' };
  const tok = id && tokenFor(id);
  if (tok) headers['x-token'] = tok;
  if (LOCAL && localStorage.getItem('sd:now')) headers['x-now'] = localStorage.getItem('sd:now');
  let r;
  try {
    r = await fetch('/api/' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw Object.assign(new Error('No connection. Check your internet and try again.'), { status: 0 });
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || 'Something went wrong.'), { status: r.status });
  return data;
}

let toastT;
export function toast(msg) {
  let t = $('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.append(t); }
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.add('hidden'), 2600);
}
export async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Link copied'); return true; } catch { return false; }
}
// Share a link through the phone's share sheet, falling back to copying it.
export async function shareLink(url, text) {
  if (navigator.share) {
    try { await navigator.share({ text, url }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  if (!(await copy(`${text} ${url}`))) prompt('Copy this link:', url);
}
