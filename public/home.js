import { $, esc, api, saveGame, myGames } from './common.js';
import { decemberSeason, todayIn, addDays, diffDays, fmtDay } from './game.js';

const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/London';
const season = decemberSeason(tz);
$('#decLine').textContent = `From ${fmtDay(season.start)} to the end of ${fmtDay(season.end)}${season.start.slice(0, 4) !== todayIn(tz).slice(0, 4) ? ' ' + season.start.slice(0, 4) : ''}.`;
const today = todayIn(tz);
// Season badge: a countdown before 1 December, the live day during it (late games are fine), hidden otherwise.
{
  const y = today.slice(0, 4);
  const toGo = diffDays(today, `${y}-12-01`);
  let t = '';
  if (toGo > 0 && toGo <= 45) t = toGo === 1 ? 'The season starts tomorrow, 1 December' : `The season starts in ${toGo} days, on 1 December`;
  else if (toGo <= 0 && today <= `${y}-12-24`) t = `Day ${1 - toGo} of 24 · it’s not too late to start a game`;
  if (t) { $('#seasonText').textContent = t; $('#season').classList.remove('hidden'); }
}
$('#start').value = today;
$('#start').min = today;
$('#end').value = addDays(today, 6);
$('#end').min = today;

for (const r of document.querySelectorAll('input[name=preset]')) {
  r.addEventListener('change', () => {
    for (const o of document.querySelectorAll('.opt')) o.classList.toggle('on', o.querySelector('input').checked);
    $('#dates').classList.toggle('hidden', r.value !== 'custom' || !r.checked);
    if (r.value === 'custom' && r.checked && $('#title').value === 'That one Christmas song') $('#title').select();
  });
}

const mine = myGames();
if (mine.length) {
  $('#mine').classList.remove('hidden');
  $('#mineList').innerHTML = mine.map((g) => `<a href="/g/${esc(g.id)}">Avoid ${esc(g.title)} →</a>`).join('');
}

$('#create').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#err').textContent = '';
  const preset = document.querySelector('input[name=preset]:checked').value;
  const body = { title: $('#title').value, rules: $('#rules').value, name: $('#name').value, preset, tz };
  if (preset === 'custom') { body.start = $('#start').value; body.end = $('#end').value; }
  if (!body.name.trim()) { $('#err').textContent = 'Please enter your nickname.'; $('#name').focus(); return; }
  $('#go').disabled = true;
  try {
    const r = await api('games', { method: 'POST', body });
    saveGame(r.id, r.token, body.title.trim());
    location.href = `/g/${r.id}?new=1`;
  } catch (err) {
    $('#err').textContent = err.message;
    $('#go').disabled = false;
  }
});
