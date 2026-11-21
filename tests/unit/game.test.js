import test from 'node:test';
import assert from 'node:assert/strict';
import { todayIn, midnightMs, decemberSeason, phaseOf, dayNumber, totalDays, stateLine, saboteurs, endsAtMs, addDays, diffDays } from '../../public/game.js';

const game = { start: '2026-12-01', end_day: '2026-12-24', tz: 'Europe/London' };
const at = (iso) => Date.parse(iso);

test('dates', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(diffDays('2026-12-01', '2026-12-24'), 23);
  assert.equal(todayIn('Australia/Sydney', at('2026-11-30T14:00:00Z')), '2026-12-01');
  assert.equal(todayIn('America/Los_Angeles', at('2026-12-01T07:00:00Z')), '2026-11-30');
});

test('midnight in a time zone, across DST', () => {
  assert.equal(midnightMs('2026-12-01', 'Europe/Warsaw'), at('2026-11-30T23:00:00Z'));
  assert.equal(midnightMs('2026-12-25', 'Australia/Sydney'), at('2026-12-24T13:00:00Z'));
  assert.equal(midnightMs('2026-03-29', 'Europe/London'), at('2026-03-29T00:00:00Z'));
  assert.equal(midnightMs('2026-03-30', 'Europe/London'), at('2026-03-29T23:00:00Z'));
  assert.equal(endsAtMs(game), at('2026-12-25T00:00:00Z'));
});

test('december season rolls to next year after Christmas Eve', () => {
  assert.deepEqual(decemberSeason('Europe/London', at('2026-11-22T12:00:00Z')), { start: '2026-12-01', end: '2026-12-24' });
  assert.deepEqual(decemberSeason('Europe/London', at('2026-12-10T12:00:00Z')), { start: '2026-12-01', end: '2026-12-24' });
  assert.deepEqual(decemberSeason('Europe/London', at('2026-12-25T00:30:00Z')), { start: '2027-12-01', end: '2027-12-24' });
});

test('phases and day numbers', () => {
  assert.equal(phaseOf(game, at('2026-11-30T23:59:00Z')), 'before');
  assert.equal(phaseOf(game, at('2026-12-01T00:00:00Z')), 'live');
  assert.equal(dayNumber(game, at('2026-12-06T10:00:00Z')), 6);
  assert.equal(phaseOf(game, at('2026-12-24T23:59:59Z')), 'live');
  assert.equal(phaseOf(game, at('2026-12-25T00:00:00Z')), 'over');
  assert.equal(totalDays(game), 24);
  assert.equal(dayNumber(game, at('2027-01-05T00:00:00Z')), 24);
});

test('state lines', () => {
  const ms = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B', out_at: 1, out_by: 'a' }, { id: 'c', name: 'C', out_at: 2, out_by: 'a' }, { id: 'd', name: 'D' }];
  assert.equal(stateLine(game, ms, at('2026-11-25T12:00:00Z')), 'Starts Tue 1 Dec · 4 players so far');
  assert.equal(stateLine(game, ms, at('2026-12-06T12:00:00Z')), 'Day 6 of 24 · 2 of 4 still in');
  assert.equal(stateLine(game, ms, at('2026-12-26T12:00:00Z')), 'Final · 2 of 4 survived');
  assert.equal(stateLine(game, ms.map((m) => ({ ...m, out_at: 5 })), at('2026-12-26T12:00:00Z')), 'Final · nobody survived (4 players)');
  assert.deepEqual(saboteurs(ms), [{ id: 'a', name: 'A', count: 2 }]);
});
