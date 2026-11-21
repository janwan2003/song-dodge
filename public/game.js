// Dodgemas: the pure game engine (dates, phases, state lines). No I/O, so it runs in the Worker, the browser and tests.
// A game runs from `start` to `end` (both YYYY-MM-DD, inclusive) in the creator's time zone. Before start nobody can be
// out; after the end day is over the game is final and everyone still in has survived.

export const REACTIONS = ['😂', '😭', '🫡', '🔥'];
export const MIN_DAYS = 1;
export const MAX_DAYS = 62;
export const WHERE_CHIPS = ['Supermarket', 'Radio', 'At work', 'In a shop', 'Car / taxi', 'Pub / bar', 'TV / ad', 'Social media', 'Sabotage!'];

export const isYmd = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
export function addDays(ymd, n) {
  const d = new Date(Date.parse(ymd + 'T00:00:00Z') + n * 86400000);
  return d.toISOString().slice(0, 10);
}
export const diffDays = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);

export function validTz(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
export function todayIn(tz, now = Date.now()) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(now));
  const g = (t) => p.find((x) => x.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}
// UTC ms of local midnight at the start of `ymd` in `tz` (handles DST by iterating on the offset).
export function midnightMs(ymd, tz) {
  const target = Date.parse(ymd + 'T00:00:00Z');
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(guess));
    const g = (t) => Number(p.find((x) => x.type === t).value);
    const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second'));
    guess += target - asUtc;
  }
  return guess;
}

// The December season: 1 Dec to the end of 24 Dec. After 24 Dec, next year's season.
export function decemberSeason(tz, now = Date.now()) {
  const today = todayIn(tz, now);
  let y = Number(today.slice(0, 4));
  if (today > `${y}-12-24`) y += 1;
  return { start: `${y}-12-01`, end: `${y}-12-24` };
}

export function phaseOf(game, now = Date.now()) {
  const today = todayIn(game.tz, now);
  if (today < game.start) return 'before';
  if (today > game.end_day) return 'over';
  return 'live';
}
export const totalDays = (game) => diffDays(game.start, game.end_day) + 1;
export function dayNumber(game, now = Date.now()) {
  const n = diffDays(game.start, todayIn(game.tz, now)) + 1;
  return Math.max(0, Math.min(n, totalDays(game)));
}
export const endsAtMs = (game) => midnightMs(addDays(game.end_day, 1), game.tz);
export const startsAtMs = (game) => midnightMs(game.start, game.tz);

export function fmtDay(ymd) {
  const d = new Date(ymd + 'T12:00:00Z');
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

// One line of live state, used by the link preview and the board header.
export function stateLine(game, members, now = Date.now()) {
  const total = members.length;
  const alive = members.filter((m) => !m.out_at).length;
  const ph = phaseOf(game, now);
  const ppl = `${total} ${total === 1 ? 'player' : 'players'}`;
  if (ph === 'before') return `Starts ${fmtDay(game.start)} · ${ppl} so far`;
  if (ph === 'over') {
    if (alive === 0) return `Final · nobody survived (${ppl})`;
    return `Final · ${alive} of ${total} survived`;
  }
  const day = `Day ${dayNumber(game, now)} of ${totalDays(game)}`;
  if (total === 0) return `${day} · no players yet`;
  if (alive === 0) return `${day} · everyone is out`;
  return `${day} · ${alive} of ${total} still in`;
}

// Saboteur table: members who knocked someone out, most first.
export function saboteurs(members) {
  const byId = new Map(members.map((m) => [m.id, m]));
  const n = new Map();
  for (const m of members) if (m.out_at && m.out_by && byId.has(m.out_by)) n.set(m.out_by, (n.get(m.out_by) || 0) + 1);
  return [...n.entries()].map(([id, count]) => ({ id, name: byId.get(id).name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
