import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mergePrNode } from '../harness-task.graph.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(__dirname, '../harness-task.graph.js'), 'utf8');

// ──────────────────────────────────────────────────────────────────────────
// Slice 1：mergePrNode merge 成功后 best-effort 建 staging_e2e 任务
// 纪律：① 两条 merged 分支都建（正常 merge + 已被外部合并幂等分支）
//       ② best-effort try/catch，永不让 merge 倒
//       ③ 不碰 langgraph interrupt（merge 返回值/路由不变）
// ──────────────────────────────────────────────────────────────────────────

describe('Slice1: mergePrNode 建 staging_e2e 任务（源码结构）', () => {
  it('引用 buildStagingE2eTaskInsert（复用 runner，不重复造 INSERT）', () => {
    expect(src).toMatch(/buildStagingE2eTaskInsert/);
  });

  it('两条 merged 分支都建任务：正常 merge 成功 + "已被外部合并"幂等分支', () => {
    // 统计 spawn helper 调用次数 ≥ 2（两个 merged return 前各一次）
    const calls = src.match(/spawnStagingE2eTask|_spawnStagingE2e/g) || [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it('spawn helper 是 best-effort：函数体含 try/catch + 不 throw', () => {
    const fnStart = src.indexOf('async function _spawnStagingE2eTask');
    expect(fnStart).toBeGreaterThan(-1);
    const fnBody = src.slice(fnStart, fnStart + 800);
    expect(fnBody).toMatch(/try/);
    expect(fnBody).toMatch(/catch/);
    expect(fnBody).not.toMatch(/throw /);
  });

  it('不引入 interrupt 到 merge 路径（merge 节点仍同步返回 status=merged）', () => {
    const fnStart = src.indexOf('async function mergePrNode');
    const fnBody = src.slice(fnStart, src.indexOf('export function routeAfterMergePr'));
    expect(fnBody).not.toMatch(/\binterrupt\(/);
  });
});

describe('Slice1: mergePrNode 运行时不因 staging spawn 失败而倒', () => {
  it('merge 成功路径：即使 staging INSERT 抛错，仍返回 status=merged', async () => {
    // poolOverride.query 抛错模拟 staging spawn 失败
    const throwingPool = { query: vi.fn(async () => { throw new Error('db down'); }) };
    const execFile = vi.fn(async () => ({ stdout: 'merged' }));
    const res = await mergePrNode(
      {
        pr_url: 'https://github.com/x/y/pull/99',
        pr_branch: 'cp-z',
        task: { id: 't1', payload: { sprint_dir: 'sprints' } },
      },
      { execFile, poolOverride: throwingPool },
    );
    // 铁律：staging spawn 失败绝不能让 merge 倒
    expect(res.status).toBe('merged');
  });
});
