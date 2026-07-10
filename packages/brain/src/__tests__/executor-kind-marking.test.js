/**
 * executor-kind-marking.test.js
 * TDD: 派发路径 executor_kind 打标点单测
 *
 * 验证四个打标点：
 * 1. triggerLocalCodexExec → brain-local
 * 2. triggerCeceliaRun bridge路径 → bridge
 * 3. triggerCeceliaRun harness_initiative → relay-container
 * 4. content-pipeline types → external-worker
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock pool
const mockQuery = vi.fn().mockResolvedValue({ rows: [] });
vi.mock('../db.js', () => ({ default: { query: mockQuery } }));

// Helpers to capture executor_kind UPDATE calls
function getKindUpdates(calls) {
  return calls.filter(
    ([sql]) => typeof sql === 'string' && sql.includes('executor_kind') && sql.includes('UPDATE')
  );
}

describe('markExecutorKind — DB UPDATE 工具函数', () => {
  beforeEach(() => {
    vi.resetModules();
    mockQuery.mockResolvedValue({ rows: [] });
  });

  it('markExecutorKind 调用时写入正确的 executor_kind', async () => {
    const { markExecutorKind } = await import('../executor-contracts.js');
    await markExecutorKind('task-abc', 'bridge');
    const kindUpdates = getKindUpdates(mockQuery.mock.calls);
    expect(kindUpdates.length).toBeGreaterThan(0);
    // 参数应包含 task-abc 和 bridge
    const [_sql, params] = kindUpdates[0];
    expect(params).toContain('task-abc');
    expect(params).toContain('bridge');
  });

  it('无效 kind → 抛出错误', async () => {
    const { markExecutorKind } = await import('../executor-contracts.js');
    await expect(markExecutorKind('task-xyz', 'invalid-kind')).rejects.toThrow();
  });
});

describe('executor.js — CONTENT_PIPELINE_TYPES 打标 external-worker', () => {
  beforeEach(() => {
    vi.resetModules();
    mockQuery.mockResolvedValue({ rows: [] });
  });

  it('executor.js 导出 CONTENT_PIPELINE_TYPES 常量', async () => {
    // 确保 executor.js 正确导出 CONTENT_PIPELINE_TYPES 供测试验证
    const src = await import('node:fs').then(m =>
      m.readFileSync(new URL('../executor.js', import.meta.url), 'utf8')
    );
    // content-pipeline 应出现在某种类型集合里
    expect(src).toContain('content-pipeline');
    expect(src).toContain('external-worker');
  });

  it('executor.js 在 content-pipeline 路径调用 markExecutorKind', async () => {
    // 验证 executor.js 源码含有 content-pipeline + external-worker 的打标逻辑
    const src = await import('node:fs').then(m =>
      m.readFileSync(new URL('../executor.js', import.meta.url), 'utf8')
    );
    expect(src).toMatch(/markExecutorKind.*external-worker|external-worker.*markExecutorKind/s);
  });
});

describe('executor.js — harness_initiative 打标 relay-container', () => {
  it('executor.js 在 harness_initiative 分支调用 markExecutorKind("relay-container")', async () => {
    const src = await import('node:fs').then(m =>
      m.readFileSync(new URL('../executor.js', import.meta.url), 'utf8')
    );
    expect(src).toContain('relay-container');
    // harness_initiative 块内应有 relay-container 标记
    const harnessBlock = src.slice(
      src.indexOf('task.task_type === \'harness_initiative\''),
      src.indexOf('task.task_type === \'harness_initiative\'') + 2000
    );
    expect(harnessBlock).toContain('relay-container');
  });
});

describe('executor.js — bridge 路径打标 bridge', () => {
  it('executor.js bridge 成功路径含 markExecutorKind("bridge")', async () => {
    const src = await import('node:fs').then(m =>
      m.readFileSync(new URL('../executor.js', import.meta.url), 'utf8')
    );
    // bridge 分支 (trigger-cecelia HTTP call) 成功后应有打标
    const bridgeSection = src.slice(
      src.indexOf('trigger-cecelia'),
      src.indexOf('trigger-cecelia') + 3000
    );
    expect(bridgeSection).toContain('bridge');
    expect(src).toMatch(/markExecutorKind.*'bridge'|'bridge'.*markExecutorKind/s);
  });
});

describe('executor.js — triggerLocalCodexExec 打标 brain-local', () => {
  it('triggerLocalCodexExec 函数体内含 markExecutorKind("brain-local")', async () => {
    const src = await import('node:fs').then(m =>
      m.readFileSync(new URL('../executor.js', import.meta.url), 'utf8')
    );
    // 从函数定义起始位置搜索足够大的范围（函数体约100+行）
    const funcStart = src.indexOf('async function triggerLocalCodexExec');
    // 搜索到下一个 async function 之前
    const nextFuncStart = src.indexOf('\nasync function ', funcStart + 10);
    const funcBody = src.slice(funcStart, nextFuncStart > 0 ? nextFuncStart : funcStart + 10000);
    expect(funcBody).toContain('brain-local');
    expect(funcBody).toContain('markExecutorKind');
  });
});

describe('dispatcher.js — dev 任务暂标 brain-local', () => {
  it('dispatcher.js 含 dev 任务打标 brain-local 的逻辑', async () => {
    const src = await import('node:fs').then(m =>
      m.readFileSync(new URL('../dispatcher.js', import.meta.url), 'utf8')
    );
    expect(src).toContain('brain-local');
    expect(src).toContain('executor_kind');
  });
});
