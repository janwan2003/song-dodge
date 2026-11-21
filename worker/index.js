// pb-song-dodge-db: one SQLite-backed Durable Object that stores every Dodgemas game.
// The account is at the free plan's 10 D1 databases, so this replaces D1. The Pages Functions forward /api/* and
// link-preview lookups here through a Durable Object binding. No public route (workers_dev = false).
import { DurableObject } from 'cloudflare:workers';
import { handleApi, previewData } from '../lib/api.js';
import SCHEMA from '../schema.sql';

// D1-style shim over ctx.storage.sql so lib/api.js is ordinary D1 code. ?1-style params become positional.
class Stmt {
  constructor(sql, q, args = []) { this.sql = sql; this.q = q; this.args = args; }
  bind(...args) { return new Stmt(this.sql, this.q, args); }
  exec() {
    let i = 0;
    const vals = [];
    const q = this.q.replace(/\?(\d+)?/g, (_, n) => {
      const v = this.args[n ? Number(n) - 1 : i++];
      vals.push(v === undefined ? null : v);
      return '?';
    });
    const cur = this.sql.exec(q, ...vals);
    return { results: cur.toArray(), meta: { changes: cur.rowsWritten } };
  }
  async first() { return this.exec().results[0] ?? null; }
  async all() { return this.exec(); }
  async run() { return this.exec(); }
}
class ShimDB {
  constructor(storage) { this.storage = storage; }
  prepare(q) { return new Stmt(this.storage.sql, q); }
  async batch(stmts) { return this.storage.transactionSync(() => stmts.map((s) => s.exec())); }
}

export class DodgeDB extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      for (const stmt of SCHEMA.replace(/--.*$/gm, '').split(';').map((s) => s.trim()).filter(Boolean)) ctx.storage.sql.exec(stmt);
    });
    this.env2 = { DB: new ShimDB(ctx.storage), TEST_HOOKS: env.TEST_HOOKS };
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/__preview/')) {
      const out = await previewData(this.env2, url.pathname.slice('/__preview/'.length));
      return new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json' } });
    }
    return handleApi(request, this.env2);
  }
}

export default { fetch: () => new Response('Not found', { status: 404 }) };
