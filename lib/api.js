// Dodgemas: JSON API. Ordinary D1-style code; in production `env.DB` is a shim over the SQLite storage of one Durable
// Object (worker/index.js). Players join with a nickname only and get a random token (stored hashed).
import { REACTIONS, MIN_DAYS, MAX_DAYS, isYmd, addDays, diffDays, validTz, todayIn, phaseOf, dayNumber, totalDays,
  decemberSeason, stateLine, endsAtMs, startsAtMs } from '../public/game.js';

const LIM = { members: 200, title: 70, rules: 280, name: 24, where: 80 };
const DAY = 86400000;
const KEEP_AFTER_END_DAYS = 60;
const UNDO_MS = 15 * 60000;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
class HttpError extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}
const bad = (msg) => new HttpError(400, msg);
const GONE = 'This game does not exist (or was deleted).';

function rid(n = 10) {
  const abc = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = crypto.getRandomValues(new Uint8Array(n));
  let s = '';
  for (const x of b) s += abc[x % abc.length];
  return s;
}
function newToken() {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function sha(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
function clean(v, max, name, required = false) {
  let s = typeof v === 'string' ? v : v == null ? '' : String(v);
  s = s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (required && !s) throw bad(`Please enter ${name}.`);
  if (s.length > max) throw bad(`${name[0].toUpperCase() + name.slice(1)} is too long (max ${max} characters).`);
  return s;
}
async function readJson(request) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > 8000) throw bad('Request too large.');
  try {
    const t = await request.text();
    if (t.length > 8000) throw bad('Request too large.');
    return t ? JSON.parse(t) : {};
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw bad('Invalid request.');
  }
}
// Fixed-window rate limit per IP (hashed), so one visitor cannot burn the free quota.
async function limit(env, request, bucket, max, windowMs = 3600000) {
  const ip = request.headers.get('cf-connecting-ip') || 'local';
  const k = `${bucket}:${await sha(ip)}`;
  const now = Date.now();
  const row = await env.DB.prepare(
    `INSERT INTO rate (k, n, reset_at) VALUES (?1, 1, ?2)
     ON CONFLICT(k) DO UPDATE SET
       n = CASE WHEN rate.reset_at < ?3 THEN 1 ELSE rate.n + 1 END,
       reset_at = CASE WHEN rate.reset_at < ?3 THEN ?2 ELSE rate.reset_at END
     RETURNING n`
  ).bind(k, now + windowMs, now).first();
  if (row && row.n > max) throw new HttpError(429, 'Too many requests from your connection. Please wait a bit and try again.');
}
// Test hook (local dev only, TEST_HOOKS=1): the x-now header moves the clock so e2e tests can play a whole season.
function nowMs(env, request) {
  if (env.TEST_HOOKS && request.headers.get('x-now')) {
    const n = Number(request.headers.get('x-now'));
    if (Number.isFinite(n)) return n;
  }
  return Date.now();
}
async function getGame(env, id) {
  if (!/^[A-Za-z0-9]{6,16}$/.test(id || '')) throw new HttpError(404, GONE);
  const g = await env.DB.prepare('SELECT * FROM games WHERE id = ?1').bind(id).first();
  if (!g) throw new HttpError(404, GONE);
  return g;
}
async function whoAmI(env, request, gameId) {
  const tok = request.headers.get('x-token');
  if (!tok || tok.length > 100) return null;
  return (await env.DB.prepare('SELECT * FROM members WHERE token_hash = ?1 AND game_id = ?2').bind(await sha(tok), gameId).first()) || null;
}
async function needMember(env, request, gameId) {
  const m = await whoAmI(env, request, gameId);
  if (!m) throw new HttpError(401, 'Join the game with your name first.');
  return m;
}
const membersOf = async (env, id) =>
  (await env.DB.prepare('SELECT * FROM members WHERE game_id = ?1 ORDER BY joined_at, id').bind(id).all()).results;
const bump = (env, id) => env.DB.prepare('UPDATE games SET version = version + 1 WHERE id = ?1').bind(id).run();

function resolveDates(body, tz, now) {
  const preset = body.preset === 'custom' ? 'custom' : 'december';
  if (preset === 'december') return { preset, ...decemberSeason(tz, now) };
  const today = todayIn(tz, now);
  const start = isYmd(body.start) ? body.start : today;
  const end = body.end;
  if (!isYmd(end)) throw bad('Pick the last day of the game.');
  if (start < today) throw bad('The game cannot start in the past.');
  if (diffDays(today, start) > 370) throw bad('The game must start within a year.');
  const n = diffDays(start, end) + 1;
  if (n < MIN_DAYS) throw bad('The last day must be on or after the first day.');
  if (n > MAX_DAYS) throw bad(`A game can last at most ${MAX_DAYS} days.`);
  return { preset, start, end };
}

function view(game, members, me, reacts, now) {
  const ph = phaseOf(game, now);
  const myReacts = new Map();
  const counts = {};
  for (const r of reacts) {
    (counts[r.target] ||= {})[r.emoji] = ((counts[r.target] || {})[r.emoji] || 0) + 1;
    if (me && r.member_id === me.id) myReacts.set(r.target, r.emoji);
  }
  return {
    game: {
      id: game.id, title: game.title, rules: game.rules, start: game.start, end: game.end_day, tz: game.tz, preset: game.preset,
      version: game.version, phase: ph, day: dayNumber(game, now), days: totalDays(game), line: stateLine(game, members, now),
      startsAt: startsAtMs(game), endsAt: endsAtMs(game),
    },
    me: me ? { id: me.id, name: me.name, host: !!me.is_host, out: !!me.out_at, canUndo: !!me.out_at && now - me.out_at < UNDO_MS && ph === 'live' } : null,
    members: members.map((m) => ({
      id: m.id, name: m.name, host: !!m.is_host, joinedDay: Math.max(1, Math.min(totalDays(game), (() => { const d = todayIn(game.tz, m.joined_at); return d < game.start ? 1 : Math.min(totalDays(game), diffDays(game.start, d) + 1); })())),
      out: m.out_at ? { at: m.out_at, day: m.out_day, where: m.out_where, by: m.out_by } : null,
      reactions: counts[m.id] || {}, myReaction: myReacts.get(m.id) || null,
    })),
    reactions: REACTIONS,
    now,
  };
}

async function state(env, request, id, now) {
  const g = await getGame(env, id);
  const members = await membersOf(env, id);
  const me = await whoAmI(env, request, id);
  const reacts = (await env.DB.prepare('SELECT target, member_id, emoji FROM reactions WHERE game_id = ?1').bind(id).all()).results;
  return view(g, members, me, reacts, now);
}

async function cleanup(env, now) {
  const old = (await env.DB.prepare('SELECT id FROM games WHERE expires_at < ?1 LIMIT 20').bind(now).all()).results;
  for (const { id } of old) await deleteGame(env, id);
  await env.DB.prepare('DELETE FROM rate WHERE reset_at < ?1').bind(now).run();
}
async function deleteGame(env, id) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM reactions WHERE game_id = ?1').bind(id),
    env.DB.prepare('DELETE FROM members WHERE game_id = ?1').bind(id),
    env.DB.prepare('DELETE FROM games WHERE id = ?1').bind(id),
  ]);
}

async function addMember(env, game, name, isHost, now) {
  const members = await membersOf(env, game.id);
  if (members.length >= LIM.members) throw bad('This game is full.');
  if (members.some((m) => m.name.toLowerCase() === name.toLowerCase())) throw new HttpError(409, `Someone called ${name} is already playing. Add an initial?`);
  const token = newToken();
  const id = rid(8);
  await env.DB.prepare('INSERT INTO members (id, game_id, name, token_hash, is_host, joined_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
    .bind(id, game.id, name, await sha(token), isHost ? 1 : 0, now).run();
  return { id, token };
}

export async function handleApi(request, env) {
  try {
    const url = new URL(request.url);
    const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
    const method = request.method;
    const now = nowMs(env, request);

    if (parts[0] === 'stats' && method === 'GET') {
      const one = async (q) => (await env.DB.prepare(q).first()).n;
      return json({
        games: await one('SELECT COUNT(*) AS n FROM games'),
        creators: await one('SELECT COUNT(*) AS n FROM members WHERE is_host = 1'),
        joiners: await one('SELECT COUNT(*) AS n FROM members WHERE is_host = 0'),
        out: await one('SELECT COUNT(*) AS n FROM members WHERE out_at IS NOT NULL'),
        new7d: await env.DB.prepare('SELECT COUNT(*) AS n FROM games WHERE created_at > ?1').bind(Date.now() - 7 * DAY).first().then((r) => r.n),
      });
    }

    if (parts[0] !== 'games') return json({ error: 'Not found' }, 404);

    if (parts.length === 1 && method === 'POST') {
      await limit(env, request, 'create', 20);
      const b = await readJson(request);
      const tz = validTz(b.tz) ? b.tz : 'Europe/London';
      const title = clean(b.title, LIM.title, 'what the group is avoiding', true);
      const rules = clean(b.rules, LIM.rules, 'the rules');
      const name = clean(b.name, LIM.name, 'your name', true);
      const d = resolveDates(b, tz, now);
      const id = rid(10);
      await env.DB.prepare('INSERT INTO games (id, title, rules, start, end_day, tz, preset, created_at, expires_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)')
        .bind(id, title, rules, d.start, d.end, tz, d.preset, now, Date.parse(d.end + 'T00:00:00Z') + KEEP_AFTER_END_DAYS * DAY).run();
      const game = await getGame(env, id);
      const m = await addMember(env, game, name, true, now);
      if (Math.random() < 0.1) await cleanup(env, Date.now());
      return json({ id, token: m.token, member: m.id });
    }

    const id = parts[1];
    const action = parts[2] || '';

    if (!action && method === 'GET') {
      await limit(env, request, 'read', 20000); // high: whole offices share one IP
      return json(await state(env, request, id, now));
    }
    if (!action && method === 'DELETE') {
      await getGame(env, id);
      const me = await needMember(env, request, id);
      if (!me.is_host) throw new HttpError(403, 'Only the person who started the game can delete it.');
      await deleteGame(env, id);
      return json({ ok: true });
    }
    if (method !== 'POST') return json({ error: 'Not found' }, 404);
    await limit(env, request, action === 'join' ? 'join' : 'write', action === 'join' ? 60 : 600);
    const game = await getGame(env, id);
    const b = await readJson(request);
    const ph = phaseOf(game, now);

    if (action === 'join') {
      if (ph === 'over') throw bad('This game is over. Start a new one for your group!');
      const name = clean(b.name, LIM.name, 'your name', true);
      const m = await addMember(env, game, name, false, now);
      await bump(env, id);
      return json({ token: m.token, member: m.id });
    }

    const me = await needMember(env, request, id);

    if (action === 'out') {
      if (ph === 'before') throw bad('The game has not started yet, so you cannot be out. Phew.');
      if (ph === 'over') throw bad('The game is over. You survived!');
      if (me.out_at) throw new HttpError(409, 'You are already out.');
      const where = clean(b.where, LIM.where, 'where it got you');
      let by = typeof b.by === 'string' && b.by ? b.by : null;
      if (by) {
        const s = await env.DB.prepare('SELECT id FROM members WHERE id = ?1 AND game_id = ?2').bind(by, id).first();
        if (!s || by === me.id) by = null;
      }
      await env.DB.prepare('UPDATE members SET out_at = ?1, out_day = ?2, out_where = ?3, out_by = ?4 WHERE id = ?5 AND out_at IS NULL')
        .bind(now, dayNumber(game, now), where, by, me.id).run();
      await bump(env, id);
      return json(await state(env, request, id, now));
    }
    if (action === 'undo') {
      if (!me.out_at) throw bad('You are still in.');
      if (now - me.out_at > UNDO_MS || ph !== 'live') throw bad('Too late to undo: you can only undo within 15 minutes.');
      await env.DB.prepare("UPDATE members SET out_at = NULL, out_day = NULL, out_where = '', out_by = NULL WHERE id = ?1").bind(me.id).run();
      await env.DB.prepare('DELETE FROM reactions WHERE game_id = ?1 AND target = ?2').bind(id, me.id).run();
      await bump(env, id);
      return json(await state(env, request, id, now));
    }
    if (action === 'react') {
      const target = String(b.target || '');
      const t = await env.DB.prepare('SELECT out_at FROM members WHERE id = ?1 AND game_id = ?2').bind(target, id).first();
      if (!t || !t.out_at) throw bad('You can only react to someone being out.');
      if (b.emoji === null || b.emoji === '') {
        await env.DB.prepare('DELETE FROM reactions WHERE game_id = ?1 AND target = ?2 AND member_id = ?3').bind(id, target, me.id).run();
      } else {
        if (!REACTIONS.includes(b.emoji)) throw bad('Unknown reaction.');
        await env.DB.prepare('INSERT INTO reactions (game_id, target, member_id, emoji) VALUES (?1,?2,?3,?4) ON CONFLICT(game_id, target, member_id) DO UPDATE SET emoji = excluded.emoji')
          .bind(id, target, me.id, b.emoji).run();
      }
      await bump(env, id);
      return json(await state(env, request, id, now));
    }
    if (action === 'edit') {
      if (!me.is_host) throw new HttpError(403, 'Only the person who started the game can edit it.');
      const title = clean(b.title, LIM.title, 'what the group is avoiding', true);
      const rules = clean(b.rules, LIM.rules, 'the rules');
      await env.DB.prepare('UPDATE games SET title = ?1, rules = ?2 WHERE id = ?3').bind(title, rules, id).run();
      await bump(env, id);
      return json(await state(env, request, id, now));
    }
    if (action === 'kick') {
      if (!me.is_host) throw new HttpError(403, 'Only the person who started the game can remove players.');
      const target = String(b.member || '');
      if (target === me.id) throw bad('You cannot remove yourself. Delete the game instead.');
      await removeMember(env, id, target);
      await bump(env, id);
      return json(await state(env, request, id, now));
    }
    if (action === 'leave') {
      if (me.is_host) throw bad('You started this game. Delete it instead of leaving.');
      await removeMember(env, id, me.id);
      await bump(env, id);
      return json({ ok: true });
    }
    return json({ error: 'Not found' }, 404);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
}
async function removeMember(env, gameId, memberId) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM reactions WHERE game_id = ?1 AND (target = ?2 OR member_id = ?2)').bind(gameId, memberId),
    env.DB.prepare('UPDATE members SET out_by = NULL WHERE game_id = ?1 AND out_by = ?2').bind(gameId, memberId),
    env.DB.prepare('DELETE FROM members WHERE game_id = ?1 AND id = ?2').bind(gameId, memberId),
  ]);
}

// Data for the link preview (functions/g/[id].js): title + live state line, e.g. "Day 6 of 24 · 5 of 9 still in".
export async function previewData(env, id) {
  try {
    const g = await getGame(env, id);
    const members = await membersOf(env, id);
    const now = Date.now();
    const last = members.filter((m) => m.out_at).sort((a, b) => b.out_at - a.out_at)[0];
    return { title: g.title, line: stateLine(g, members, now), phase: phaseOf(g, now), lastOut: last ? { name: last.name, where: last.out_where } : null };
  } catch {
    return null;
  }
}
