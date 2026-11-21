import { $, esc, api, saveGame, myGames } from './common.js';
import { decemberSeason, todayIn, addDays, fmtDay } from './game.js';

const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/London';
const season = decemberSeason(tz);
$('#decLine').textContent = `From ${fmtDay(season.start)} to the end of ${fmtDay(season.end)}${season.start.slice(0, 4) !== todayIn(tz).slice(0, 4) ? ' ' + season.start.slice(0, 4) : ''}.`;
const today = todayIn(tz);
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
