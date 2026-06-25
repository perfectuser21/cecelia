import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mergePrNode } from '../harness-task.graph.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const graphSrc = readFileSync(resolve(__dirname, '../harness-task.graph.js'), 'utf8');
const initSrc = readFileSync(resolve(__dirname, '../harness-initiative.graph.js'), 'utf8');
const runnerSrc = readFileSync(resolve(__dirname, '../../staging-e2e-runner.js'), 'utf8');

// ──────────────────────────────────────────────────────────────────────────
// Slice1 修正（决策 C）：把 #3425 的 per-initiative reportNode 无去重派生
// 纠正为 spec §3 的 per-merge（mergePrNode）触发 + pr_url 幂等。
// ──────────────────────────────────────────────────────────────────────────

describe('修正1：reportNode 不再派生 staging_e2e（移除 per-initiative 无去重派生）', () => {
  it('harness-initiative.graph.js 不含 staging_e2e 的 INSERT INTO tasks 派生', () => {
    // 仍可在注释里提到 staging_e2e，但不能有 INSERT ... 'staging_e2e' 的派生动作
    const hasSpawn = /INSERT INTO tasks[\s\S]{0,200}'staging_e2e'/.test(initSrc);
    expect(hasSpawn).toBe(false);
  });
});

describe('修正2：mergePrNode per-merge 派生 staging_e2e（两条 merged 分支，幂等，不碰 interrupt）', () => {
  it('mergePrNode 路径含 staging_e2e 派生 helper，且两条 merged 分支都建', () => {
    const calls = graphSrc.match(/_spawnStagingE2eTask/g) || [];
    // 1 个 helper 定义 + 2 个调用（正常 merge + 已被外部合并幂等分支）
    expect(calls.length).toBeGreaterThanOrEqual(3);
  });

  it('派生 helper best-effort：try/catch + 永不 throw', () => {
    const i = graphSrc.indexOf('async function _spawnStagingE2eTask');
    expect(i).toBeGreaterThan(-1);
    // helper 体到下一个 export async function 为止
    const end = graphSrc.indexOf('export async function mergePrNode', i);
    const body = graphSrc.slice(i, end);
    expect(body).toMatch(/try/);
    expect(body).toMatch(/catch/);
    expect(body).not.toMatch(/\bthrow\b/);
  });

  it('幂等：派生 SQL 按 pr_url 去重（NOT EXISTS / ON CONFLICT）', () => {
    const i = graphSrc.indexOf('async function _spawnStagingE2eTask');
    const end = graphSrc.indexOf('export async function mergePrNode', i);
    const body = graphSrc.slice(i, end);
    expect(body).toMatch(/NOT EXISTS|ON CONFLICT/i);
    expect(body).toMatch(/pr_url/);
  });

  it('mergePrNode 不引入 interrupt（merge 节点同步返回 status=merged）', () => {
    const i = graphSrc.indexOf('async function mergePrNode');
    const body = graphSrc.slice(i, graphSrc.indexOf('export function routeAfterMergePr'));
    expect(body).not.toMatch(/\binterrupt\(/);
  });

  it('运行时：staging 派生 INSERT 抛错时 merge 仍返回 status=merged（best-effort）', async () => {
    const throwingPool = { query: vi.fn(async () => { throw new Error('db down'); }) };
    const execFile = vi.fn(async () => ({ stdout: 'merged' }));
    const res = await mergePrNode(
      { pr_url: 'https://github.com/x/y/pull/77', pr_branch: 'cp-z', task: { id: 't', payload: {} } },
      { execFile, poolOverride: throwingPool },
    );
    expect(res.status).toBe('merged');
  });
});

describe('修正3：recordResult 落 verdict 用 ON CONFLICT(pr_url) DO NOTHING（DB 级幂等）', () => {
  it('staging-e2e-runner.js recordResult INSERT 含 ON CONFLICT ... pr_url ... DO NOTHING', () => {
    expect(runnerSrc).toMatch(/INSERT INTO staging_e2e_results[\s\S]{0,400}ON CONFLICT[\s\S]{0,40}pr_url[\s\S]{0,40}DO NOTHING/i);
  });
});
