import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { archiveGoldenPathT0 } from '../golden-path-archive.js';
import { createGoldenPathJournal } from '../golden-path-journal.js';
import { goldenPathSource } from '../golden-path-audit-runtime.js';
import { inspectGoldenPathWindow } from '../golden-path-window.js';

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const BEGIN = Date.parse('2026-10-02T00:00:00Z'), WEEK = 7 * 24 * 3600_000;
function fixture({ archived = false, short = false, unknown = false, gap = false, missingAck = false, flagOn = false, leaseGap = false, sourceMismatch = false, missingManifest = false, dbAckMismatch = false } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'gp-window-private-')); roots.push(root);
  const windowId = randomUUID(), source = goldenPathSource({ GIT_SHA: 'a'.repeat(40) });
  const window = { window_id: windowId, t0_event_id: 123, source };
  const t0 = { id: 123, created_at: new Date(BEGIN).toISOString(), payload: { window_id: windowId, source, gp_db_created_at: new Date(BEGIN).toISOString() } };
  const journal = createGoldenPathJournal(path.join(root, windowId));
  archiveGoldenPathT0(path.join(root, windowId), t0);
  const rows = [];
  // 真实私有文件中的确定性外部DB证据夹具；裁决/读取/hash链运行真实模块。
  function append(record) {
    const row = { ...record, source: record.source ?? source, window_id: windowId, instance_id: journal.instanceId,
      seq: rows.length + 1, previous_hash: rows.at(-1)?.record_hash ?? null };
    row.record_hash = createHash('sha256').update(JSON.stringify(row)).digest('hex'); rows.push(row);
  }
  append({ kind: 't0_receipt', event_id: t0.id, created_at: t0.created_at, payload: t0.payload });
  let eventId = 200;
  function event(lifecycle, at) {
    const audit_id = randomUUID();
    append({ kind: 'intent', event_type: 'golden_path_observation_health', payload: {
      audit_id, lifecycle, healthy: true, legacy_read_enabled: flagOn } });
    append({ kind: 'ack', audit_id, event_id: eventId++, created_at: new Date(at).toISOString(), gp_db_created_at: new Date(at).toISOString(), db_time: new Date(at).toISOString() });
  }
  event('instance_start', BEGIN); event('listening', BEGIN);
  for (let at = BEGIN + 60_000; at < BEGIN + WEEK; at += 60_000) {
    if (!leaseGap || at !== BEGIN + 60_000) event('heartbeat', at);
  }
  event('instance_end', BEGIN + WEEK);
  if (unknown) {
    const audit_id = randomUUID();
    append({ kind: 'intent', event_type: 'golden_path_legacy_access', payload: {
      audit_id, caller: { kind: 'unknown' }, legacy_read_enabled: false } });
    append({ kind: 'ack', audit_id, event_id: eventId++, created_at: t0.created_at, gp_db_created_at: t0.created_at, db_time: t0.created_at });
  }
  if (gap) append({ kind: 'gap', reason: 'database_failure' });
  if (sourceMismatch) append({ kind: 'gap_free_record', source: { ...source, git_sha: 'b'.repeat(40) } });
  if (dbAckMismatch) {
    const last = rows.at(-1); last.gp_db_created_at = new Date(BEGIN).toISOString();
    delete last.record_hash; last.record_hash = createHash('sha256').update(JSON.stringify(last)).digest('hex');
  }
  if (missingAck) rows.pop();
  writeFileSync(journal.file, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  if (missingManifest) rmSync(path.join(root, windowId, 'instances.manifest.jsonl'));
  const pool = { query: async input => {
    const sql = input.text;
    if (sql.includes('FROM tasks')) return { rows: [{ window }] };
    if (sql.includes('FROM cecelia_events')) return { rows: archived ? [] : [t0] };
    if (sql.includes('clock_timestamp')) return { rows: [{ db_now: new Date(BEGIN + WEEK - (short ? 1 : 0)).toISOString() }] };
    throw new Error('unexpected query');
  } };
  return { root, pool };
}

describe('七日裁决只读边界', () => {
  it('真实DB时刻满168小时且完整来源/健康/ACK链才接受', async () => {
    const f = fixture();
    expect(await inspectGoldenPathWindow(f)).toMatchObject({ accepted: true, actual_access_count: 0, reasons: [] });
  });
  it('DB七日清理后只用先前真实T0回执归档，不使用自报日期', async () => {
    const f = fixture({ archived: true });
    expect((await inspectGoldenPathWindow(f)).accepted).toBe(true);
  });
  it.each([
    ['差1毫秒', { short: true }, 'seven_real_days_incomplete'],
    ['未知caller', { unknown: true }, 'caller_unresolved'],
    ['持久gap', { gap: true }, 'coverage_gap'],
    ['缺ACK', { missingAck: true }, 'ack_unproven'],
    ['flag开启', { flagOn: true }, 'flag_or_health_invalid'],
    ['lease断档', { leaseGap: true }, 'health_lease_gap'],
    ['source漂移', { sourceMismatch: true }, 'source_unadmitted'],
    ['manifest缺失', { missingManifest: true }, 'journal_manifest_missing'],
    ['ACK数据库绝对时刻不一致', { dbAckMismatch: true }, 'ack_unproven'],
  ])('%s不能被heartbeat或到期洗绿', async (_name, options, reason) => {
    const result = await inspectGoldenPathWindow(fixture(options));
    expect(result.accepted).toBe(false); expect(result.reasons).toContain(reason);
  });
  it('没有真身T0登记拒绝，不看旧blocked_until', async () => {
    const pool = { query: async () => ({ rows: [{ window: null }] }) };
    expect(await inspectGoldenPathWindow({ pool, root: '/unused' })).toMatchObject({ accepted: false, reasons: ['window_not_admitted'] });
  });
});
