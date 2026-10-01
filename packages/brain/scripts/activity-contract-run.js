#!/usr/bin/env node
import { writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runActivityContract } from '../src/orchestrator/activity-runtime.js';

const EVENT_ERRORS = new Set(['activity_run_id_invalid', 'activity_source_id_invalid', 'activity_run_tag_invalid',
  'activity_source_busy', 'activity_run_not_found', 'activity_source_already_used', 'activity_event_pool_required',
  'activity_event_sink_closed', 'activity_run_identity_mismatch', 'activity_event_sequence_invalid',
  'activity_event_store_unavailable', 'activity_event_database_url_required', 'event_db_binding_required',
  'invalid_cli_argument', 'secret_material_forbidden', 'non_json_value_forbidden', 'structured_value_too_deep',
  'free_text_too_long', 'array_item_limit_exceeded', 'object_key_limit_exceeded', 'cyclic_value_forbidden']);

// stdin={contract:{workflow,activities},input:{run_tag,...}}；stdout=唯一终态JSON。
export async function main(argv = process.argv.slice(2), stream = process.stdin) {
  let envelope, receiptPath, eventPool, eventDb = false;
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
    let cwd = process.cwd(), runId, sourceId;
    for (let i = 0; i < argv.length; i++) {
      if (argv[i] === '--event-db') { if (eventDb) throw new Error('invalid_cli_argument'); eventDb = true; continue; }
      if (!['--cwd', '--receipt', '--brain-run-id', '--event-source-id'].includes(argv[i])
        || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('invalid_cli_argument');
      const option = argv[i++], value = argv[i];
      if (option === '--cwd') cwd = resolve(value);
      else if (option === '--receipt') receiptPath = resolve(value);
      else if (option === '--brain-run-id') { if (runId) throw new Error('invalid_cli_argument'); runId = value; }
      else { if (sourceId) throw new Error('invalid_cli_argument'); sourceId = value; }
    }
    if (eventDb ? !runId || !sourceId : runId || sourceId) throw new Error('event_db_binding_required');
    let text = '';
    for await (const chunk of stream) {
      text += chunk;
      if (Buffer.byteLength(text) > 16 * 1024 * 1024) throw new Error('input_overflow');
    }
    envelope = JSON.parse(text);
    const options = { cwd, signal: abort.signal,
      onEvent: async (event, receipt) => { persist({ ...receipt, cursor: event.cursor, last_event: event }); } };
    if (eventDb) {
      if (!process.env.ACTIVITY_EVENT_DATABASE_URL) throw new Error('activity_event_database_url_required');
      const [{ default: pg }, { runActivityContractWithEventStore }] = await Promise.all([
        import('pg'), import('../src/orchestrator/activity-event-sink.js')]);
      eventPool = new pg.Pool({ connectionString: process.env.ACTIVITY_EVENT_DATABASE_URL,
        max: 1, connectionTimeoutMillis: 5000, query_timeout: 5000 });
      result = await runActivityContractWithEventStore(envelope.contract, envelope.input,
        { ...options, pool: eventPool, runId, sourceId });
    } else result = await runActivityContract(envelope.contract, envelope.input, options);
  } catch (error) {
    const runTag = envelope?.input?.run_tag ?? null;
    result = { schema_version: 1, run_tag: eventDb && (typeof runTag !== 'string'
      || !/^[A-Za-z0-9_.:/-]{1,128}$/.test(runTag)) ? null : runTag, status: 'failed',
      reason_code: 'invalid_contract', detail: eventDb && !EVENT_ERRORS.has(error.message)
        ? 'activity_event_store_unavailable' : error.message, outputs: {}, metrics: {}, evidence: [], activities: [] };
  } finally {
    process.off('SIGTERM', stop); process.off('SIGINT', stop);
    if (eventPool) await eventPool.end();
  }
  try { persist(result); }
  catch {
    result.reason_code = 'event_sink_failed';
    if (result.status === 'completed') result.status = result.activities.some(a =>
      a.attempts?.some(attempt => Object.values(attempt.outputs || {}).some(value =>
        Array.isArray(value) ? value.length > 0 : value != null))) ? 'partial' : 'failed';
  }
  process.stdout.write(JSON.stringify(result) + '\n');
  return result.status === 'completed' ? 0 : result.status === 'partial' ? 2 : 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; });
}
