import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createGoldenPathAudit } from '../golden-path-audit.js';
import { readGoldenPathJournal } from '../golden-path-journal.js';
import { startGoldenPathAudit, setGoldenPathAudit, stopGoldenPathAudit } from '../golden-path-audit-runtime.js';
import { fixture, hit } from './gp-audit-fixture.js';

describe('GP专属持久审计', () => {
  it('真实私有journal先intent后真实ACK，caller unknown且输入秘密不写入', async () => {
    const f = fixture();
    const result = await f.audit.recordHttp({ ...hit, actor: 'forged', token: 'secret', body: 'PII' });
    expect(result.persisted).toBe(true);
    const records = readGoldenPathJournal(f.audit.file);
    expect(records.map(r => r.kind)).toEqual(['intent', 'ack']);
    expect(records[1].event_id).toBe(f.events[0].id);
    expect(f.events[0].payload.caller).toEqual({ kind: 'unknown', identity_source: 'not_bound' });
    expect(readFileSync(f.audit.file, 'utf8')).not.toMatch(/forged|secret|PII/);
  });

  it('DB故障持久gap，恢复重放保留gap不洗绿', async () => {
    const persist = vi.fn().mockRejectedValueOnce(new Error('secret-database-detail'));
    const f = fixture({ persist });
    expect((await f.audit.recordHttp(hit)).persisted).toBe(false);
    expect(readGoldenPathJournal(f.audit.file).map(r => r.kind)).toEqual(['intent', 'gap']);
    expect(readFileSync(f.audit.file, 'utf8')).not.toContain('secret-database-detail');
    persist.mockResolvedValue({ id: 88, created_at: '2026-10-02T00:00:00Z', db_time: '2026-10-02T00:00:00Z' });
    await f.audit.recover();
    expect(f.audit.status().healthy).toBe(false);
    expect(readGoldenPathJournal(f.audit.file).some(r => r.kind === 'recovered_ack' && r.event_id === 88)).toBe(true);
  });

  it('isolated启动零DB/文件/timer；hung关机有界且明确gap', async () => {
    const pool = { query: vi.fn() };
    expect(await startGoldenPathAudit({ pool, env: { NODE_ENV: 'test' } })).toEqual({ disabled: true });
    expect(pool.query).not.toHaveBeenCalled();
    const f = fixture({ persist: () => new Promise(() => {}) });
    setGoldenPathAudit(f.audit);
    expect(await stopGoldenPathAudit(5)).toEqual({ completed: false });
    expect(f.audit.status()).toMatchObject({ healthy: false, closed: true, lastGap: 'gp_shutdown_incomplete' });
  });

  it('内部两条路径有恒定代码caller；任意operation拒绝且零事件', async () => {
    const f = fixture();
    for (const operation of ['step_invariants', 'cumulative_fr']) {
      expect((await f.audit.recordInternal(operation)).persisted).toBe(true);
    }
    expect(f.events.map(e => e.payload.caller.operation)).toEqual(['step_invariants', 'cumulative_fr']);
    expect(f.events.every(e => e.payload.caller.kind === 'internal_code')).toBe(true);
    await expect(f.audit.recordInternal('arbitrary-user')).rejects.toThrow('gp_internal_operation_invalid');
    expect(f.events).toHaveLength(2);
  });

  it('实例启动/监听/健康/结束均有DB回执，不自动开T0或timer', async () => {
    const f = fixture(); await f.audit.start(); await f.audit.listening();
    await f.audit.heartbeat(); await f.audit.stop();
    expect(f.events.map(e => e.payload.lifecycle)).toEqual(['instance_start', 'listening', 'heartbeat', 'instance_end']);
    expect(f.events.every(e => e.payload.window_id === 'unadmitted')).toBe(true);
    expect(f.events.some(e => e.event_type === 'golden_path_observation_t0')).toBe(false);
  });

  async function overlap() {
    const f = fixture(); let now = '2026-10-02T00:00:30Z';
    f.store.lease = async instanceId => { const row = f.events.findLast(e => e.payload.instance_id === instanceId); return {
      db_now: now, latest: row ? { ...row.payload, gp_db_created_at: row.gp_db_created_at } : null,
    }; };
    await f.audit.recover(); await f.audit.start(); await f.audit.listening(); await f.audit.heartbeat();
    const next = createGoldenPathAudit({ root: f.root, store: f.store, source: f.audit.identity().source, flag: () => false });
    return { f, next, expire: () => { now = '2026-10-02T00:01:01Z'; } };
  }
  it('正常bluegreen仍有真实DB lease的活实例不得永久记崩溃gap', async () => {
    const { f, next } = await overlap(); await next.recover();
    expect(next.status().healthy).toBe(true);
    await f.audit.stop(); await next.heartbeat(); expect(next.status().healthy).toBe(true);
  });
  it('并行实例真正无end且DB lease过期后必须永久gap', async () => {
    const { next, expire } = await overlap(); await next.recover();
    expect(next.status().healthy).toBe(true); expire(); await next.heartbeat();
    expect(next.status().healthy).toBe(false);
    expect(readGoldenPathJournal(next.file).some(r => r.kind === 'gap' && r.reason === 'gp_previous_instance_unclosed')).toBe(true);
  });

});
