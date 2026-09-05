// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：常驻监工唤醒器（第 81 批）
//
// 回家工程第二块（第 80 批序列器核心的运行时搭档）：
//   一 run 一会话（claude -p --session-id 开局，--resume 逐收口唤醒）
//   喂食纪律：只喂 home-sequencer 蒸馏摘要（≤1200B），永不喂工人原文
//   裁定+疑点落台账（审计 + 会话丢失重建源）
//   唤醒失败三级降级：重问一次 → 从台账重建会话 → 终局升人
//
// 测试策略：CLI 子进程用注入的 fake runner（真 spawn 在冒烟/金丝雀验），
// 台账写用真 pg 内存桩（fake pool 记录 SQL），封闭词表/降级逻辑全真。
import { describe, it, expect, vi } from 'vitest';
import {
  buildCharter,
  createCommanderSession,
  wakeCommander,
  rebuildSessionFromLedger,
} from '../../../packages/brain/src/orchestrator/commander-invoker.js';

const okRunner = (replies) => {
  let i = 0;
  const calls = [];
  const fn = vi.fn(async (args, prompt) => {
    calls.push({ args, prompt });
    return replies[Math.min(i++, replies.length - 1)];
  });
  fn.calls = calls;
  return fn;
};

const fakePool = () => {
  const rows = [];
  return {
    rows,
    query: vi.fn(async (sql, params) => {
      if (/INSERT INTO sequencer_ledger/i.test(sql)) rows.push(params);
      if (/SELECT .* FROM sequencer_ledger/i.test(sql)) {
        return { rows: rows.map((p) => ({ run_id: p[0], stage_id: p[1], stage_attempt: p[2], verdict: p[3], reasoning: p[4], digest: p[5] })) };
      }
      return { rows: [] };
    }),
  };
};

describe('F1 step3 — charter 与开局（第 81 批）', () => {
  it('charter 含裁定纪律、封闭词表、跨格记忆职责与题目原文', () => {
    const c = buildCharter({ runId: 'r-1', taskRequest: '修 X 文档偏差', gear: 'new_capability' });
    expect(c).toMatch(/accepted \/ retry \/ blocked/);
    expect(c).toMatch(/VERDICT:/);
    expect(c).toMatch(/跨格记忆/);
    expect(c).toMatch(/修 X 文档偏差/);
  });

  it('开局用 --session-id 起会话并返回 sessionId', async () => {
    const runner = okRunner(['监工就位']);
    const s = await createCommanderSession(
      { runId: 'r-1', taskRequest: 't', gear: 'bugfix' }, { runner });
    expect(s.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(runner.calls[0].args).toContain('--session-id');
    expect(runner.calls[0].args).toContain(s.sessionId);
  });
});

describe('F1 step3 — 唤醒与台账（喂食纪律+审计）', () => {
  it('唤醒用 --resume 同一会话，只喂 digest，返回裁定并写台账', async () => {
    const runner = okRunner(['证据自洽。\nVERDICT: accepted']);
    const pool = fakePool();
    const r = await wakeCommander({
      sessionId: 'aaaaaaaa-0000-4000-8000-000000000001', runId: 'r-1',
      stageId: 'plan', stageAttempt: 1, digest: '收口 — 阶段:plan …',
    }, { runner, pool });
    expect(r.verdict).toBe('accepted');
    expect(runner.calls[0].args).toContain('--resume');
    expect(runner.calls[0].prompt).toContain('收口 — 阶段:plan');
    expect(pool.rows.length).toBe(1);
    expect(pool.rows[0][3]).toBe('accepted');
  });

  it('digest 超过 1200 字节 → 直接抛错（喂食纪律是闸不是建议）', async () => {
    await expect(wakeCommander({
      sessionId: 'aaaaaaaa-0000-4000-8000-000000000001', runId: 'r-1',
      stageId: 'plan', stageAttempt: 1, digest: 'x'.repeat(4000),
    }, { runner: okRunner(['VERDICT: accepted']), pool: fakePool() }))
      .rejects.toThrow(/digest_too_large/);
  });

  it('首答无机器行 → 自动重问一次（降级一级），第二答有效则采纳', async () => {
    const runner = okRunner(['我觉得挺好', '补：\nVERDICT: retry']);
    const pool = fakePool();
    const r = await wakeCommander({
      sessionId: 'aaaaaaaa-0000-4000-8000-000000000001', runId: 'r-1',
      stageId: 'contract', stageAttempt: 2, digest: 'd',
    }, { runner, pool });
    expect(r.verdict).toBe('retry');
    expect(runner.calls.length).toBe(2);
    expect(runner.calls[1].prompt).toMatch(/VERDICT/);
  });

  it('重问仍无效 → 返回 verdict=null 交由调用方升人，不猜', async () => {
    const runner = okRunner(['???', '还是不说词']);
    const r = await wakeCommander({
      sessionId: 'aaaaaaaa-0000-4000-8000-000000000001', runId: 'r-1',
      stageId: 'judge', stageAttempt: 1, digest: 'd',
    }, { runner, pool: fakePool() });
    expect(r.verdict).toBeNull();
    expect(r.escalate).toBe(true);
  });

  it('CLI 抛错（进程失败）→ 不吞：报错带 stage 上下文', async () => {
    const runner = vi.fn(async () => { throw new Error('spawn ENOENT'); });
    await expect(wakeCommander({
      sessionId: 'aaaaaaaa-0000-4000-8000-000000000001', runId: 'r-1',
      stageId: 'plan', stageAttempt: 1, digest: 'd',
    }, { runner, pool: fakePool() })).rejects.toThrow(/commander_wake_failed:plan/);
  });
});

describe('F1 step3 — 会话丢失重建（降级二级）', () => {
  it('用台账里全部裁定记录重开新会话，回放摘要+裁定史', async () => {
    const pool = fakePool();
    pool.rows.push(
      ['r-1', 'plan', 1, 'accepted', 'PRD 忠实', 'digest-plan'],
      ['r-1', 'contract', 1, 'retry', '断言7有保留', 'digest-c1'],
      ['r-1', 'contract', 2, 'accepted', '已修', 'digest-c2'],
    );
    const runner = okRunner(['监工已恢复上下文']);
    const s = await rebuildSessionFromLedger(
      { runId: 'r-1', taskRequest: 't', gear: 'new_capability' }, { runner, pool });
    expect(s.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    const replay = runner.calls[0].prompt;
    expect(replay).toMatch(/断言7有保留/);
    expect(replay).toMatch(/digest-c2/);
    expect(replay.indexOf('digest-plan')).toBeLessThan(replay.indexOf('digest-c2'));
  });
});
