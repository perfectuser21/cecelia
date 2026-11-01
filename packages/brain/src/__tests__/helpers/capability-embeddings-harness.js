import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

export const embeddingScriptSource = () => readFileSync(new URL('../../generate-capability-embeddings.mjs', import.meta.url), 'utf8');

// Execute the actual CLI body, replacing only its imported DB/model boundaries.
// A VM keeps process.exit, time and logging local to this one execution.
export async function runEmbeddingScript({ capabilities, outcomes = [], times = [], source = embeddingScriptSource() }) {
  const calls = { texts: [], writes: [], exits: [], released: 0, ended: 0, logs: [] };
  const exitSignal = new Error('test process exited');
  let clock = 0;
  let haltedCalls;
  const client = {
    async query(sql, params) {
      if (sql.startsWith('SELECT id,')) return { rows: capabilities };
      if (sql.startsWith('UPDATE capabilities_legacy')) {
        calls.writes.push({ sql, params });
        return { rowCount: 1 };
      }
      if (sql.startsWith('SELECT COUNT')) return { rows: [{ count: String(calls.writes.length) }] };
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() { calls.released++; },
  };
  const executable = source.replace(/^import .*;\n/gm, '');
  try {
    await runInNewContext(executable, {
      pkg: { Pool: class {
        async connect() { return client; }
        async end() { calls.ended++; }
      } },
      DB_DEFAULTS: {},
      async generateEmbedding(text) {
        const outcome = outcomes[calls.texts.length] ?? [0.25, -0.5];
        calls.texts.push(text);
        if (outcome instanceof Error) throw outcome;
        return outcome;
      },
      Date: { now: () => times[clock++] ?? 0 },
      setTimeout: callback => callback(),
      process: { exit(code) {
        calls.exits.push(code);
        // process.exit bypasses finally in the real CLI. Ignore all VM effects
        // after the first exit rather than claiming they happened in production.
        haltedCalls ??= structuredClone(calls);
        throw exitSignal;
      } },
      console: Object.fromEntries(['log', 'error'].map(method => [method, (...args) => calls.logs.push(args.join(' '))])),
    }, { filename: 'generate-capability-embeddings.mjs' });
  } catch (error) {
    if (error !== exitSignal) throw error;
  }
  return haltedCalls ?? calls;
}
