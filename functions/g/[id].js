// Serves the game board with a link preview (Open Graph) showing live state, e.g.
// "Day 6 of 24 · 5 of 9 still in · Last out: Sam (supermarket)".
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function onRequestGet({ request, env, params }) {
  const url = new URL(request.url);
  const page = await env.ASSETS.fetch(new URL('/g', url.origin));
  let html = await page.text();
  let title = 'Dodgemas · who is still in?';
  let desc = 'A last-one-standing board for your group’s song-dodging game. Join with a nickname. No sign-up, no app.';
  try {
    const id = String(params.id || '');
    if (/^[A-Za-z0-9]{6,16}$/.test(id)) {
      const stub = env.GAMES.get(env.GAMES.idFromName('main'));
      const r = await stub.fetch(new Request(`https://do/__preview/${id}`));
      const p = await r.json();
      if (p) {
        title = `Avoid ${p.title} · Dodgemas`;
        const last = p.lastOut ? ` Last out: ${p.lastOut.name}${p.lastOut.where ? ` (${p.lastOut.where})` : ''}.` : '';
        const cta = p.phase === 'over' ? 'See who survived, then start your own.' : 'Tap to join with a nickname. No sign-up.';
        desc = `${p.line}.${last} ${cta}`;
      }
    }
  } catch (e) {
    console.error(e);
  }
  const meta = `<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Dodgemas">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url.origin + url.pathname)}">
<meta property="og:image" content="${url.origin}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="robots" content="noindex">`;
  html = html.replace(/<!--META-->[\s\S]*?<!--\/META-->/, meta);
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
