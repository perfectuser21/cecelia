// F1「工厂 · 开发闭环」步骤 1 —— 边：接单进车间时，派发 prompt 必须带上项目链上下文
//
// ── 病根（2026-09-22 实测）──
//
// handoff 写了 82/162 份，读取器 getRecentHandoffs 零调用：上一棒把棒子放桌上，
// 下一棒进车间根本不知道桌上有棒子。主理人：「所有东西都在我脑子里记着」。
//
// ── 守卫 ──
//
// 派发 prompt 的组装点是 harness-skill-relay.buildRelayPrompt（headless controller /
// headed 两条路都走它）。任务在链上（有 parent_task_id）→ prompt 必含
// 「项目链上下文」：根标题、根目标、第 n/total 棒、最近 handoff、写 handoff 的规矩；
// 孤立任务 → prompt 与之前逐字一致（不给无链任务加噪音）。
// 链上下文由 handoff.buildChainPromptSafe 沿真列查库拼出；查库炸了也只能是空串，不许挡派发。

import { describe, it, expect, vi } from 'vitest';

const ROOT = '11111111-1111-4111-8111-111111111111';
const PREV = '22222222-2222-4222-8222-222222222222';
const SELF = '33333333-3333-4333-8333-333333333333';

// 只 mock 库（真列查询的返回），不 mock 被改模块
vi.mock('../../../packages/brain/src/db.js', () => ({
  default: {
    query: vi.fn(async (sql, params) => {
      if (/WITH RECURSIVE up/.test(sql)) {
        if (params[0] === SELF) {
          return { rows: [
            { id: SELF, parent_task_id: ROOT, title: '第二棒：接棒与闸', task_type: 'dev', status: 'queued', sequence_no: 2, depth: 0 },
            { id: ROOT, parent_task_id: null, title: '接力棒：任务留痕与长链', description: '主理人不说也有人动', task_type: 'project', status: 'in_progress', sequence_no: null, depth: 1 },
          ] };
        }
        return { rows: [{ id: params[0], parent_task_id: null, title: '孤立任务', task_type: 'dev', status: 'queued', sequence_no: null, depth: 0 }] };
      }
      if (/count\(\*\)::int AS total/.test(sql)) return { rows: [{ total: 3 }] };
      if (/WITH RECURSIVE down/.test(sql)) {
        if (params[0] !== ROOT) return { rows: [] };
        return { rows: [{ id: PREV, title: '第一棒：脊柱', completed_at: '2026-09-23T00:00:00Z', handoff: { verdict: 'PASS', done: ['458 真列落地'], next_steps: [{ kind: 'task', title: '做接棒' }] } }] };
      }
      return { rows: [] };
    }),
  },
}));

// 真 import 被改模块 —— 守卫在边上，不 mock 它
import { buildRelayPrompt } from '../../../packages/brain/src/harness-skill-relay.js';
import { buildChainPromptSafe } from '../../../packages/brain/src/handoff.js';
import pool from '../../../packages/brain/src/db.js';

const BASE = { skillContent: '# SKILL 正文', sprintDir: 'sprints/0923-relay', brainUrl: 'http://host.docker.internal:5221', reviewRequired: false, gear: 'S' };

describe('F1 step1 · 接单进车间：派发 prompt 带项目链上下文', () => {
  it('链上任务：controller prompt 含根标题 / 根目标 / 第 n/total 棒 / 上一棒 handoff / 写 handoff 规矩', async () => {
    const chainContext = await buildChainPromptSafe({ pool }, SELF);
    const prompt = buildRelayPrompt({ kind: 'controller', task: { id: SELF, title: '第二棒：接棒与闸' }, chainContext, ...BASE });
    expect(prompt).toContain('## 项目链上下文');
    expect(prompt).toContain('接力棒：任务留痕与长链');
    expect(prompt).toContain('目标：主理人不说也有人动');
    expect(prompt).toContain('第 2 / 3 棒');
    expect(prompt).toContain('458 真列落地');
    expect(prompt).toContain('kind=task|decision|done');
    // 原有上下文头一个不少
    expect(prompt).toContain(`HARNESS_TASK_ID=${SELF}`);
    expect(prompt).toContain('REVIEW_REQUIRED=false');
    expect(prompt).toContain('HARNESS_GEAR=S');
    // 链上下文在任务标题之后（先读任务，再读链）
    expect(prompt.indexOf('任务标题：')).toBeLessThan(prompt.indexOf('## 项目链上下文'));
  });

  it('headed prompt 同样注入，且不带 controller 专属的 REVIEW/GEAR 行', async () => {
    const chainContext = await buildChainPromptSafe({ pool }, SELF);
    const prompt = buildRelayPrompt({ kind: 'headed', task: { id: SELF, title: 'x' }, chainContext, ...BASE, brainUrl: 'http://localhost:5221' });
    expect(prompt).toContain('Kernel Harness 2.0 headed session');
    expect(prompt).toContain('BRAIN_URL=http://localhost:5221');
    expect(prompt).toContain('## 项目链上下文');
    expect(prompt).not.toContain('REVIEW_REQUIRED=');
  });

  it('孤立任务：prompt 与之前逐字一致，不多一行', async () => {
    const chainContext = await buildChainPromptSafe({ pool }, '44444444-4444-4444-8444-444444444444');
    expect(chainContext).toBe('');
    const prompt = buildRelayPrompt({ kind: 'controller', task: { id: 'solo', title: '孤立' }, chainContext, ...BASE });
    expect(prompt).not.toContain('项目链上下文');
    expect(prompt.split('\n').at(-1)).toBe('任务标题：孤立');
  });

  it('查库炸了 → 链上下文空串，派发不受影响', async () => {
    const boom = { query: vi.fn(async () => { throw new Error('db down'); }) };
    expect(await buildChainPromptSafe({ pool: boom }, SELF)).toBe('');
  });
});
