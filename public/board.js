// The game board: join, I'm out (where + who got me), undo, reactions, saboteur table, share cards, host tools.
import { $, esc, api, tokenFor, saveGame, forgetGame, toast, copy, shareLink } from './common.js';
import { WHERE_CHIPS, saboteurs, fmtDay } from './game.js';
import { drawCard, toBlob } from './card.js';

const id = location.pathname.split('/').filter(Boolean)[1] || '';
const view = $('#view');
const sheetRoot = $('#sheetRoot');
let S = null; // last state from the server
const link = () => `${location.origin}/g/${id}`;

// A personal link (#k=token) moves a player to another device.
if (location.hash.startsWith('#k=')) {
  const t = decodeURIComponent(location.hash.slice(3));
  if (t) localStorage.setItem('sd:tok:' + id, t);
  history.replaceState(null, '', location.pathname);
}

async function load() {
  try {
    S = await api('games/' + id, { id });
    if (!S.me && tokenFor(id)) forgetGame(id); // removed or stale token
    if (S.me) saveGame(id, tokenFor(id), S.game.title);
    render();
  } catch (e) {
    if (e.status === 404) {
      forgetGame(id);
      view.innerHTML = `<div class="card center"><h2>This game is gone</h2><p class="mute">${esc(e.message)}</p><a class="btn red" href="/#start">Start a new game</a></div>`;
    } else if (!S) {
      view.innerHTML = `<div class="card center"><h2>Could not load the board</h2><p class="mute">${esc(e.message)}</p><button class="btn" onclick="location.reload()">Try again</button></div>`;
    }
  }
}

const nameOf = (mid) => S.members.find((m) => m.id === mid)?.name;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

function heroHtml(g, alive, total) {
  let big = '';
  if (g.phase === 'before') {
    const days = Math.max(1, Math.ceil((g.startsAt - S.now) / 86400000));
    big = `<div class="big"><b>${days}</b><span>${days === 1 ? 'day' : 'days'} to go · starts ${esc(fmtDay(g.start))}</span></div>`;
  } else if (g.phase === 'live') {
    big = `<div class="big"><b>${alive}</b><span>of ${total} still in · day ${g.day} of ${g.days}</span></div><div class="bar"><i style="width:${Math.round((g.day / g.days) * 100)}%"></i></div>`;
  } else {
    big = `<div class="big"><b>${alive}</b><span>${alive === 1 ? 'survivor' : 'survivors'} of ${total} · game over</span></div>`;
  }
  return `<section class="hero"><div class="kicker">${g.phase === 'over' ? 'Final result' : 'Avoid at all costs'}</div><h1>${esc(g.title)}</h1>${big}${g.rules ? `<p class="rules">${esc(g.rules)}</p>` : ''}</section>`;
}

function render() {
  const g = S.game, me = S.me;
  const alive = S.members.filter((m) => !m.out);
  const fallen = S.members.filter((m) => m.out).sort((a, b) => b.out.at - a.out.at);
  const total = S.members.length;
  const sab = saboteurs(S.members.map((m) => ({ id: m.id, name: m.name, out_at: m.out?.at, out_by: m.out?.by })));
  document.title = `Avoid ${g.title} · Dodgemas`;
  let h = heroHtml(g, alive.length, total);

  // --- you
  if (!me) {
    if (g.phase === 'over') {
      h += `<section class="card center"><h2>This game is over</h2><p class="mute">Start one for your own group. It takes 20 seconds.</p><a class="btn red block" href="/#start">Start your own game</a></section>`;
    } else {
      h += `<section class="card" id="joinBox"><h2>${total ? `${plural(total, 'player')} ${g.phase === 'before' ? 'so far' : 'playing'}. Are you in?` : 'Be the first one in'}</h2>
        <form id="join" novalidate><div class="field"><label for="jname">Your nickname</label><input id="jname" type="text" maxlength="24" placeholder="e.g. Alex" autocomplete="nickname"></div>
        <button class="btn red block" type="submit" id="jgo">I’m in</button><p class="err" id="jerr" role="alert"></p></form>
        <p class="hint">No sign-up. Your nickname is only shown in this game.</p></section>`;
    }
  } else if (g.phase === 'before') {
    h += `<section class="card"><h2>You’re in, ${esc(me.name)}</h2><p class="mute">The game starts ${esc(fmtDay(g.start))}. Until then, listen to whatever you like. Now get the group in:</p>${inviteHtml(true)}</section>`;
  } else if (g.phase === 'live' && !me.out) {
    h += `<section class="card"><h2>You’re still in, ${esc(me.name)}</h2><p class="mute">Heard it? Be honest. Tap the button and tell everyone where it got you.</p>
      <button class="btn red block" id="outBtn">I heard it… I’m out</button>
      <div class="row" style="margin-top:10px"><button class="btn ghost sm" id="brag">Share my “still in” card</button></div></section>`;
  } else if (me.out) {
    const mine = S.members.find((m) => m.id === me.id);
    h += `<section class="card outbox"><h2>You’re out, ${esc(me.name)}</h2><p>Day ${mine.out.day}${mine.out.where ? ` · ${esc(mine.out.where)}` : ''}${mine.out.by ? ` · got by <b>${esc(nameOf(mine.out.by))}</b>` : ''}</p>
      <div class="row"><button class="btn red" id="cardOut">Share my “I’m out” card</button>${me.canUndo ? '<button class="btn ghost" id="undo">Undo (tapped by mistake)</button>' : ''}</div>
      <p class="hint" style="margin-top:12px">Playing with another group too? <a href="/#start">Start a game for them</a>. Each game is separate.</p></section>`;
  } else if (g.phase === 'over') {
    h += `<section class="card winbox center"><div style="font-size:48px">👑</div><h2>You survived, ${esc(me.name)}!</h2><p class="mute">All ${g.days} days. Legend.</p><button class="btn red block" id="cardWon">Share my survivor card</button></section>`;
  }

  // --- the final hall
  if (g.phase === 'over') {
    h += `<section class="card winbox"><h2>👑 The survivors</h2>${alive.length ? `<div class="list">${alive.map((m) => `<span class="chip gold">${esc(m.name)}</span>`).join('')}</div>` : '<p class="mute">Nobody made it this year. The song wins.</p>'}
      <div class="row" style="margin-top:14px"><button class="btn ghost sm" id="cardHall">Share the survivors card</button><a class="btn pine sm" href="/#start">Start a new game</a></div></section>`;
  }

  // --- still in
  if (g.phase !== 'over') {
    h += `<section class="card"><h2>${g.phase === 'before' ? 'Players' : 'Still in'} <span class="mute small">(${alive.length})</span></h2>${alive.length ? `<div class="list" id="aliveList">${alive.map((m) => `<span class="chip${me && m.id === me.id ? ' me' : ''}">${esc(m.name)}${m.host ? ' <span title="Started this game">★</span>' : ''}${m.joinedDay > 1 && g.phase !== 'before' ? ` <span class="small mute">· from day ${m.joinedDay}</span>` : ''}</span>`).join('')}</div>` : '<p class="mute">Everyone is out. The song wins.</p>'}
      ${me && g.phase === 'live' ? `<p class="small mute" style="margin:14px 0 6px">Late joiners welcome. Invite more:</p>${inviteHtml(false)}` : ''}</section>`;
  }

  // --- fallen
  if (fallen.length) {
    h += `<section class="card"><h2>The fallen <span class="mute small">(${fallen.length})</span></h2><ul class="fallen" id="fallen">${fallen.map((m) => {
      const r = S.reactions.map((e) => { const n = m.reactions[e] || 0; return `<button data-react="${m.id}" data-emoji="${e}" class="${m.myReaction === e ? 'on' : ''}" aria-label="React ${e}">${e}${n ? ' ' + n : ''}</button>`; }).join('');
      return `<li><span class="day">Day<b>${m.out.day}</b></span><span class="who">${esc(m.name)}</span><span class="how">${m.out.where ? esc(m.out.where) : '<span class="mute">No details. Too painful.</span>'}${m.out.by && nameOf(m.out.by) ? ` · got by <b>${esc(nameOf(m.out.by))}</b> 😈` : ''}</span>${me ? `<span class="reacts">${r}</span>` : ''}</li>`;
    }).join('')}</ul></section>`;
  }

  // --- saboteurs
  if (sab.length) {
    h += `<section class="card"><h2>😈 Saboteurs</h2><table class="sab">${sab.map((s) => `<tr><td>${esc(s.name)}</td><td>${plural(s.count, 'victim')}</td></tr>`).join('')}</table></section>`;
  }

  // --- tools
  if (me) {
    h += `<section class="card"><h3>Your game</h3><div class="tools">
      <button id="devLink">Open on another device</button>
      ${me.host ? '<button id="edit">Edit name and rules</button><button id="kick">Players and personal links</button><button id="del">Delete game</button>' : '<button id="leave">Leave this game</button>'}
      </div></section>`;
  }
  view.innerHTML = h;
  bind();
  if (new URLSearchParams(location.search).get('new') && me?.host) {
    history.replaceState(null, '', location.pathname);
    openSheet(`<h2>Your game is ready 🎉</h2><p>Now send the link to the group chat. Everyone who opens it can join with a nickname.</p>${inviteHtml(true)}<button class="btn ghost block" data-close style="margin-top:10px">Done</button>`);
  }
}

function inviteHtml(primary) {
  return `<div class="linkbox"><input type="text" readonly value="${esc(link())}" aria-label="Game link" id="linkIn${primary ? 'P' : ''}"><button class="btn ${primary ? 'red' : 'ghost'} sm" data-invite>${navigator.share ? 'Share' : 'Copy'}</button></div>`;
}
function inviteText() {
  const g = S.game;
  if (g.phase === 'before') return `Who can last longest without hearing ${g.title}? Starts ${fmtDay(g.start)}. Join our game:`;
  return `${S.game.line}. Join our game (avoid ${g.title}):`;
}

function bind() {
  const on = (sel, fn) => { const el = $(sel); if (el) el.addEventListener('click', fn); };
  document.querySelectorAll('[data-invite]').forEach((b) => b.addEventListener('click', () => shareLink(link(), inviteText())));
  const jf = $('#join');
  if (jf) jf.addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#jerr').textContent = '';
    const name = $('#jname').value.trim();
    if (!name) { $('#jerr').textContent = 'Please enter your nickname.'; return; }
    $('#jgo').disabled = true;
    try {
      const r = await api(`games/${id}/join`, { method: 'POST', body: { name } });
      saveGame(id, r.token, S.game.title);
      await load();
      toast(`You’re in, ${name}!`);
    } catch (err) { $('#jerr').textContent = err.message; $('#jgo').disabled = false; }
  });
  on('#outBtn', outSheet);
  on('#undo', async () => { try { S = await api(`games/${id}/undo`, { method: 'POST', id }); render(); toast('Undone. You’re back in.'); } catch (e) { toast(e.message); } });
  on('#cardOut', () => shareCard('out'));
  on('#brag', () => shareCard('in'));
  on('#cardWon', () => shareCard('won'));
  on('#cardHall', () => shareCard('hall'));
  document.querySelectorAll('[data-react]').forEach((b) => b.addEventListener('click', async () => {
    const m = S.members.find((x) => x.id === b.dataset.react);
    const emoji = m.myReaction === b.dataset.emoji ? null : b.dataset.emoji;
    try { S = await api(`games/${id}/react`, { method: 'POST', id, body: { target: m.id, emoji } }); render(); } catch (e) { toast(e.message); }
  }));
  on('#devLink', () => openSheet(`<h2>Open on another device</h2><p class="mute">This private link signs you in as <b>${esc(S.me.name)}</b>. Don’t share it with the group.</p><div class="linkbox"><input type="text" readonly value="${esc(link() + '#k=' + encodeURIComponent(tokenFor(id)))}" id="devIn"><button class="btn sm" id="devCopy">Copy</button></div><button class="btn ghost block" data-close style="margin-top:12px">Close</button>`, () => on('#devCopy', () => copy($('#devIn').value))));
  on('#leave', async () => {
    if (!confirm('Leave this game? Your name and your record will be removed.')) return;
    try { await api(`games/${id}/leave`, { method: 'POST', id }); forgetGame(id); await load(); toast('You left the game.'); } catch (e) { toast(e.message); }
  });
  on('#del', async () => {
    if (!confirm('Delete this game for everyone? This cannot be undone.')) return;
    try { await api(`games/${id}`, { method: 'DELETE', id }); forgetGame(id); location.href = '/'; } catch (e) { toast(e.message); }
  });
  on('#edit', () => openSheet(`<h2>Edit the game</h2><form id="editF"><div class="field"><label for="eTitle">What the group is avoiding</label><input id="eTitle" type="text" maxlength="70" value="${esc(S.game.title)}"></div><div class="field"><label for="eRules">House rules</label><textarea id="eRules" rows="3" maxlength="280">${esc(S.game.rules)}</textarea></div><button class="btn red block">Save</button><p class="err" id="eErr"></p></form>`, () => {
    $('#editF').addEventListener('submit', async (e) => {
      e.preventDefault();
      try { S = await api(`games/${id}/edit`, { method: 'POST', id, body: { title: $('#eTitle').value, rules: $('#eRules').value } }); closeSheet(); render(); toast('Saved'); } catch (err) { $('#eErr').textContent = err.message; }
    });
  }));
  on('#kick', playersSheet);
}

// Host tools per player: a fresh personal link (for someone who lost access, e.g. joined inside a chat app's browser
// and later opened the link elsewhere) and remove (duplicates, people who joined by mistake).
function playersSheet() {
  const others = S.members.filter((m) => m.id !== S.me.id);
  openSheet(`<h2>Players</h2>${others.length ? `<p class="mute">Someone lost their place (new phone, or they joined inside a chat app)? Send them a new personal link. Remove is for duplicates and mistakes.</p>
    <ul class="plist">${others.map((m) => `<li><span class="pname">${esc(m.name)}${m.out ? ' <span class="small mute">· out</span>' : ''}</span><button class="btn ghost sm" data-relink="${esc(m.id)}">Personal link</button><button class="btn ghost sm danger" data-kick="${esc(m.id)}" aria-label="Remove ${esc(m.name)}">Remove</button></li>`).join('')}</ul>
    <div id="relinkOut"></div>` : '<p class="mute">Nobody else has joined yet.</p>'}<button class="btn ghost block" data-close style="margin-top:12px">Close</button>`, () => {
    document.querySelectorAll('[data-kick]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm(`Remove ${nameOf(b.dataset.kick)} from the game?`)) return;
      try { S = await api(`games/${id}/kick`, { method: 'POST', id, body: { member: b.dataset.kick } }); closeSheet(); render(); toast('Removed'); } catch (e) { toast(e.message); }
    }));
    document.querySelectorAll('[data-relink]').forEach((b) => b.addEventListener('click', async () => {
      const who = nameOf(b.dataset.relink);
      if (!confirm(`Make a new personal link for ${who}? It signs them in as ${who}; their old link stops working.`)) return;
      try {
        const r = await api(`games/${id}/relink`, { method: 'POST', id, body: { member: b.dataset.relink } });
        const url = `${link()}#k=${encodeURIComponent(r.token)}`;
        $('#relinkOut').innerHTML = `<div class="relink"><p><b>Send this to ${esc(who)} only.</b> It signs them in as ${esc(who)}.</p><div class="linkbox"><input type="text" readonly value="${esc(url)}" id="relinkIn" aria-label="Personal link for ${esc(who)}"><button class="btn red sm" id="relinkSend">${navigator.share ? 'Send' : 'Copy'}</button></div></div>`;
        $('#relinkSend').addEventListener('click', () => shareLink(url, `${who}, this is your personal Dodgemas link. Don’t share it:`));
        $('#relinkIn').scrollIntoView({ block: 'nearest' });
      } catch (e) { toast(e.message); }
    }));
  });
}

let sheetUrl = null; // object URL of the card shown in the sheet, released on close
let sheetOpener = null;
function openSheet(html, after) {
  if (!sheetRoot.innerHTML) sheetOpener = document.activeElement;
  releaseCard();
  sheetRoot.innerHTML = `<div class="sheet-bg" id="sheetBg"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheetTitle" id="sheet" tabindex="-1">${html}</div></div>`;
  $('#sheet h2')?.setAttribute('id', 'sheetTitle');
  document.body.classList.add('locked');
  $('#sheet').focus({ preventScroll: true });
  $('#sheetBg').addEventListener('click', (e) => { if (e.target.id === 'sheetBg' || e.target.closest('[data-close]')) closeSheet(); });
  sheetRoot.querySelectorAll('[data-invite]').forEach((b) => b.addEventListener('click', () => shareLink(link(), inviteText())));
  after?.();
}
function releaseCard() { if (sheetUrl) { URL.revokeObjectURL(sheetUrl); sheetUrl = null; } }
function closeSheet() {
  releaseCard();
  sheetRoot.innerHTML = '';
  document.body.classList.remove('locked');
  if (sheetOpener && document.contains(sheetOpener)) sheetOpener.focus({ preventScroll: true });
  sheetOpener = null;
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheetRoot.innerHTML) closeSheet(); });

function outSheet() {
  const others = S.members.filter((m) => m.id !== S.me.id);
  openSheet(`<h2>Where did it get you?</h2>
    <div class="chips" id="chips">${WHERE_CHIPS.map((c) => `<button type="button">${esc(c)}</button>`).join('')}</div>
    <div class="field"><input id="where" type="text" maxlength="80" placeholder="e.g. Tesco self-checkout, 8:15 am"><div class="hint">Optional, but the group wants details.</div></div>
    <div class="field"><label for="by">Who got you?</label><select id="by"><option value="">Nobody. It was the world.</option>${others.map((m) => `<option value="${m.id}">${esc(m.name)} (sabotage!)</option>`).join('')}</select></div>
    <button class="btn red block" id="confirmOut">Confirm: I’m out</button>
    <button class="btn ghost block" data-close style="margin-top:8px">Wait, I’m still in</button><p class="err" id="oErr"></p>`, () => {
    document.querySelectorAll('#chips button').forEach((b) => b.addEventListener('click', () => {
      const w = $('#where');
      document.querySelectorAll('#chips button').forEach((x) => x.classList.toggle('on', x === b));
      if (!w.value || WHERE_CHIPS.includes(w.value)) w.value = b.textContent;
      if (b.textContent === 'Sabotage!') $('#by').focus();
    }));
    $('#confirmOut').addEventListener('click', async () => {
      $('#confirmOut').disabled = true;
      try {
        S = await api(`games/${id}/out`, { method: 'POST', id, body: { where: $('#where').value, by: $('#by').value } });
        closeSheet(); render();
        shareCard('out', true);
      } catch (e) { $('#oErr').textContent = e.message; $('#confirmOut').disabled = false; }
    });
  });
}

function cardData() {
  const g = S.game;
  const mine = S.me && S.members.find((m) => m.id === S.me.id);
  const alive = S.members.filter((m) => !m.out);
  return { title: g.title, day: mine?.out?.day || g.day, days: g.days, where: mine?.out?.where, by: mine?.out?.by && nameOf(mine.out.by), alive: alive.length, total: S.members.length, names: alive.map((m) => m.name) };
}
async function shareCard(kind, justOut = false) {
  const canvas = drawCard(kind, cardData());
  const blob = await toBlob(canvas);
  const file = new File([blob], `dodgemas-${kind}.png`, { type: 'image/png' });
  const text = { out: `I’m out. ${S.game.line}. Who’s next?`, in: `Day ${S.game.day} and I’m still in.`, won: 'I survived!', hall: `The survivors: ${cardData().names.join(', ') || 'nobody'}.` }[kind];
  const url = URL.createObjectURL(blob);
  openSheet(`<h2>${justOut ? 'Out. Tell everyone.' : 'Your card'}</h2><img class="preview-img" src="${url}" alt="Share card" id="cardImg">
    <div class="row"><button class="btn red" id="shareImg">Share image</button><a class="btn ghost" href="${url}" download="${file.name}">Save</a></div>
    <p class="hint">On a phone, you can also press and hold the image to save it.</p><button class="btn ghost block" data-close style="margin-top:8px">Close</button>`, () => {
    sheetUrl = url;
    $('#shareImg').addEventListener('click', async () => {
      const data = { files: [file], text: `${text} ${link()}` };
      if (navigator.canShare?.(data)) {
        try { await navigator.share(data); } catch {}
      } else {
        await shareLink(link(), text);
      }
    });
  });
}

// Live updates: re-fetch every 60 s while the tab is visible, and on returning to the tab (one small JSON).
// Skipped while a sheet is open or the person is typing, so a refresh never wipes a half-typed nickname.
function busy() {
  if (sheetRoot.innerHTML) return true;
  const a = document.activeElement;
  if (a && view.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && !a.readOnly) return true;
  return !!$('#jname')?.value.trim();
}
const refresh = () => { if (document.visibilityState === 'visible' && !busy()) load(); };
setInterval(refresh, 60000);
document.addEventListener('visibilitychange', refresh);
load();
