#!/usr/bin/env node
import { writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runActivityContract } from '../src/orchestrator/activity-runtime.js';

// stdin={contract:{workflow,activities},input:{run_tag,...}}；stdout=唯一终态JSON。
export async function main(argv = process.argv.slice(2), stream = process.stdin) {
  let envelope, receiptPath;
  const abort = new AbortController();
  const stop = () => abort.abort();
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  const persist = receipt => {
    if (!receiptPath) return;
    mkdirSync(dirname(receiptPath), { recursive: true });
    const pending = receiptPath + '.' + process.pid + '.tmp';
    writeFileSync(pending, JSON.stringify(receipt) + '\n', { mode: 0o600, flush: true });
    renameSync(pending, receiptPath);
  };
  let result;
  try {
    let cwd = process.cwd();
    for (let i = 0; i < argv.length; i++) {
      if (!['--cwd', '--receipt'].includes(argv[i]) || !argv[i + 1]) throw new Error('invalid_cli_argument');
      const option = argv[i++], value = resolve(argv[i]);
      if (option === '--cwd') cwd = value; else receiptPath = value;
    }
    let text = '';
    for await (const chunk of stream) {
      text += chunk;
      if (Buffer.byteLength(text) > 16 * 1024 * 1024) throw new Error('input_overflow');
    }
    envelope = JSON.parse(text);
    result = await runActivityContract(envelope.contract, envelope.input, { cwd, signal: abort.signal,
      onEvent: async (event, receipt) => { persist({ ...receipt, cursor: event.cursor, last_event: event }); } });
  } catch (error) {
    result = { schema_version: 1, run_tag: envelope?.input?.run_tag ?? null, status: 'failed',
      reason_code: 'invalid_contract', detail: error.message, outputs: {}, metrics: {}, evidence: [], activities: [] };
  } finally { process.off('SIGTERM', stop); process.off('SIGINT', stop); }
  persist(result);
  process.stdout.write(JSON.stringify(result) + '\n');
  return result.status === 'completed' ? 0 : result.status === 'partial' ? 2 : 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; });
}
