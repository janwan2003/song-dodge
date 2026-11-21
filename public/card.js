// Share cards drawn on a canvas (1080x1350, the portrait size feeds and chats show best). No server rendering needed.
const W = 1080, H = 1350;
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const THEMES = {
  out: ['#D02338', '#7E0F1E', '#FFF6EA', '#FFD9A0'],
  in: ['#227A54', '#0E3B28', '#F2FFF7', '#B8F0CF'],
  won: ['#2A2116', '#120D07', '#FFF3D6', '#F2C14E'],
};

function wrap(ctx, text, maxW) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}
function fit(ctx, text, weight, start, maxW, min = 40) {
  let s = start;
  do { ctx.font = `${weight} ${s}px ${FONT}`; s -= 4; } while (ctx.measureText(text).width > maxW && s > min);
}
function para(ctx, text, y, size, weight, color, maxLines = 3, lh = 1.22) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.fillStyle = color;
  let lines = wrap(ctx, text, W - 160);
  if (lines.length > maxLines) { lines = lines.slice(0, maxLines); lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, '') + '…'; }
  for (const l of lines) { ctx.fillText(l, W / 2, y); y += size * lh; }
  return y;
}
function pill(ctx, text, y, bg, fg) {
  ctx.font = `750 40px ${FONT}`;
  const w = ctx.measureText(text).width + 70;
  ctx.fillStyle = bg;
  ctx.beginPath(); ctx.roundRect((W - w) / 2, y - 48, w, 72, 36); ctx.fill();
  ctx.fillStyle = fg; ctx.fillText(text, W / 2, y);
}
function note(ctx, x, y, s, color) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s / 512, s / 512); ctx.fillStyle = color;
  ctx.fill(new Path2D('M346 104v214a66 66 0 1 1-42-61.5V170l-120 26v156a66 66 0 1 1-42-61.5V160z'));
  ctx.restore();
}

// kind: 'out' | 'in' | 'won' | 'hall'. d: { title, day, days, where, by, alive, total, names, name }
export function drawCard(kind, d) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const [a, b, fg, accent] = THEMES[kind === 'hall' ? 'won' : kind];
  const g = ctx.createLinearGradient(0, 0, W * 0.4, H);
  g.addColorStop(0, a); g.addColorStop(1, b);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // faint scattered notes
  ctx.globalAlpha = 0.07;
  [[40, 250, 130], [910, 330, 110], [30, 860, 120], [920, 800, 140]].forEach(([x, y, s]) => note(ctx, x, y, s, fg));
  ctx.globalAlpha = 1;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  ctx.font = `800 34px ${FONT}`; ctx.fillStyle = accent;
  ctx.fillText('D O D G E M A S', W / 2, 120);
  para(ctx, `Avoiding: ${d.title}`, 180, 38, 600, fg, 2);

  let y;
  if (kind === 'out') {
    ctx.fillStyle = fg; fit(ctx, 'I’M OUT', 900, 230, W - 120); ctx.fillText('I’M OUT', W / 2, 520);
    ctx.font = `800 64px ${FONT}`; ctx.fillStyle = accent; ctx.fillText(`Day ${d.day} of ${d.days}`, W / 2, 630);
    y = 740;
    if (d.where) y = para(ctx, `“${d.where}”`, y, 52, 650, fg, 3) + 10;
    if (d.by) y = para(ctx, `Got by ${d.by}`, y, 46, 750, accent, 1) + 10;
    pill(ctx, `${d.alive} of ${d.total} still in`, Math.max(y + 60, 1040), 'rgba(255,255,255,.16)', fg);
  } else if (kind === 'in') {
    ctx.fillStyle = fg; fit(ctx, 'STILL IN', 900, 210, W - 120); ctx.fillText('STILL IN', W / 2, 520);
    ctx.font = `800 64px ${FONT}`; ctx.fillStyle = accent; ctx.fillText(`Day ${d.day} of ${d.days}`, W / 2, 630);
    y = para(ctx, d.day > 1 ? `${d.day} days and not one note. Try me.` : 'Day one. Not one note. Try me.', 740, 50, 600, fg, 3);
    pill(ctx, `${d.alive} of ${d.total} still standing`, Math.max(y + 80, 1040), 'rgba(255,255,255,.16)', fg);
  } else if (kind === 'won') {
    ctx.fillStyle = accent; ctx.font = `400 150px ${FONT}`; ctx.fillText('👑', W / 2, 430);
    ctx.fillStyle = fg; fit(ctx, 'I SURVIVED', 900, 170, W - 120); ctx.fillText('I SURVIVED', W / 2, 610);
    y = para(ctx, `All ${d.days} days without hearing it.`, 720, 52, 650, fg, 2);
    pill(ctx, d.alive === 1 ? `The only survivor of ${d.total}` : `One of ${d.alive} survivors out of ${d.total}`, Math.max(y + 80, 1040), 'rgba(242,193,78,.2)', accent);
  } else {
    ctx.fillStyle = accent; ctx.font = `400 120px ${FONT}`; ctx.fillText('👑', W / 2, 380);
    ctx.fillStyle = fg; fit(ctx, 'THE SURVIVORS', 900, 120, W - 120); ctx.fillText('THE SURVIVORS', W / 2, 520);
    const names = d.names.length ? d.names : ['Nobody made it'];
    const shown = names.slice(0, 8);
    const size = shown.length > 5 ? 52 : 64;
    y = 630;
    ctx.font = `750 ${size}px ${FONT}`; ctx.fillStyle = fg;
    for (const n of shown) { ctx.fillText(n, W / 2, y); y += size * 1.25; }
    if (names.length > shown.length) { ctx.font = `600 44px ${FONT}`; ctx.fillText(`+ ${names.length - shown.length} more`, W / 2, y); y += 60; }
    pill(ctx, `${d.alive} of ${d.total} made it through ${d.days} days`, Math.max(y + 50, 1090), 'rgba(242,193,78,.2)', accent);
  }
  ctx.font = `600 32px ${FONT}`; ctx.fillStyle = fg; ctx.globalAlpha = 0.8;
  ctx.fillText('Start a game for your group · pb-song-dodge.pages.dev', W / 2, H - 70);
  ctx.globalAlpha = 1;
  return c;
}
export const toBlob = (c) => new Promise((r) => c.toBlob(r, 'image/png'));
