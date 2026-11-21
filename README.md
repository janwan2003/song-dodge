# Dodgemas: a last-one-standing board for your group's song-dodging game

Free at **https://pb-song-dodge.pages.dev** · product/support page: https://janwan2003.github.io/song-dodge/

One person starts a game (the 1–24 December season, or custom dates for any "avoid it" game) and shares the link.
Friends join with a nickname. When the song gets someone, they tap **I'm out**, say where, and optionally who
sabotaged them. The board shows who is still in, the fallen timeline with reactions, a saboteur table, and after the
last day the survivors. Share cards (1080x1350 PNG, drawn in the browser): "I'm out", "Still in", "I survived",
"The survivors". No accounts, no app, no ads.

## Stack
Cloudflare Pages (static `public/`, no build step) + Pages Functions (`functions/`) forwarding to one SQLite-backed
Durable Object in the Worker `pb-song-dodge-db` (`worker/`, schema in `schema.sql`), because the account is at the
free plan's 10 D1 databases. `lib/api.js` is D1-style code on a shim. `public/game.js` is the pure engine (dates,
phases, state lines), shared by the Worker, the browser and the unit tests. Rate limits per hashed IP (create 20/h,
join 60/h, writes 600/h, reads 20000/h (offices share one IP); the board polls every 60 s while visible). Games delete themselves 60 days after their last day. Undo within 15 minutes.

## Develop
```
npx -y pnpm@9 install
echo TEST_HOOKS=1 > worker/.dev.vars          # enables the x-now clock header (local only)
(cd worker && npx wrangler dev --port 8896 --ip 127.0.0.1 --persist-to ../.wrangler/state) &
npx wrangler pages dev --port 8895 --ip 127.0.0.1 --persist-to .wrangler/state
npm run test:unit
node tests/e2e/run.mjs        # real Chromium, 8 contexts, time travel through the season, screenshots in shots/
node tools/render-images.mjs  # og.png + icons (also copied to docs/)
```

## Deploy
```
set -a; . ../../.env; set +a
(cd worker && npx wrangler deploy)        # only when worker/, lib/, public/game.js or schema.sql changed
npx wrangler pages deploy --branch main
BASE=https://pb-song-dodge.pages.dev SHOTS=shots/prod node tests/e2e/run.mjs  # custom game starting today; deletes itself
python3 scripts/gsc.py status
```
