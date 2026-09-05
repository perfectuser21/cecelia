/**
 * commander-invoker 包内单测（配套 tests/gp/f1/step3-commander-invoker.test.js）。
 * GP 那份锁「边」的行为契约；这份锁模块 API 形状与边界值。
 */
import { describe, it, expect, vi } from 'vitest';
import {
  buildCharter,
  createCommanderSession,
  wakeCommander,
} from '../commander-invoker.js';

describe('commander-invoker 模块 API', () => {
  it('charter 把 run 身份与档位写进开场（监工要知道自己在哪个 run）', () => {
    const c = buildCharter({ runId: 'coding-x-1', taskRequest: 't', gear: 'bugfix' });
    expect(c).toMatch(/coding-x-1/);
    expect(c).toMatch(/bugfix/);
  });

  it('charter 判则含瞬时/持久基础设施故障之分（v1423a 重放偏差的纠正）', () => {
    const c = buildCharter({ runId: 'r', taskRequest: 't', gear: 'new_capability' });
    expect(c).toMatch(/瞬时/);
    expect(c).toMatch(/持久/);
  });

  it('开局每次生成全新 sessionId（不复用）', async () => {
    const runner = vi.fn(async () => 'ok');
    const a = await createCommanderSession({ runId: 'r', taskRequest: 't', gear: 'bugfix' }, { runner });
    const b = await createCommanderSession({ runId: 'r', taskRequest: 't', gear: 'bugfix' }, { runner });
    expect(a.sessionId).not.toBe(b.sessionId);
  });

  it('无 pool 时唤醒仍工作（台账写是可选依赖，不阻塞裁定）', async () => {
    const runner = vi.fn(async () => 'ok\nVERDICT: accepted');
    const r = await wakeCommander({
      sessionId: 'aaaaaaaa-0000-4000-8000-000000000001', runId: 'r',
      stageId: 'plan', stageAttempt: 1, digest: 'd',
    }, { runner });
    expect(r.verdict).toBe('accepted');
  });

  it('重问后仍无效 → 台账记 unparseable（审计不留空洞）', async () => {
    const rows = [];
    const pool = { query: vi.fn(async (sql, params) => { if (/INSERT/.test(sql)) rows.push(params); return { rows: [] }; }) };
    const runner = vi.fn(async () => '不说词');
    const r = await wakeCommander({
      sessionId: 'aaaaaaaa-0000-4000-8000-000000000001', runId: 'r',
      stageId: 'plan', stageAttempt: 1, digest: 'd',
    }, { runner, pool });
    expect(r.escalate).toBe(true);
    expect(rows[0][3]).toBe('unparseable');
  });
});
