/**
 * codex-test-gen-description.test.js — TDD Red/Green 阶段测试
 *
 * Sprint: 07180825-codex-gen-description-fix
 * Task:   c3528706-8c83-4df0-a2af-31e6483ec05f
 *
 * 验收目标：
 *   断言 runCodexTestGen 入队的任务 body 含合规 description、
 *   candidate_test_paths 及合法 priority。
 *
 * 设计说明：
 *   通过 mock scanMissingTestFiles 模块函数以强制返回候选文件，
 *   避免因测试文件已全部存在导致 candidates 为空而跳过所有断言。
 *
 * Red 阶段：在 codex-test-gen.js 修复前，所有 B-1～B-4 断言必须 FAIL。
 * Green 阶段：修复后所有断言 PASS。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as codexTestGenModule from '../codex-test-gen.js';

// ---- 测试辅助：mock fetch，捕获入队 body ----

let capturedBodies = [];

function makeMockFetch(statusOk = true) {
  return vi.fn(async (_url, opts) => {
    if (opts?.method === 'POST' || opts?.method === 'PATCH') {
      try {
        capturedBodies.push(JSON.parse(opts.body));
      } catch {
        // ignore parse errors
      }
    }
    return {
      ok: statusOk,
      status: statusOk ? 200 : 500,
      json: async () => ({ id: 'test-task-id-00000000' }),
    };
  });
}

// Mock pool：模拟 DB 去重查询返回空集合（让任务进入入队分支）
function makeMockPool() {
  return {
    query: vi.fn(async () => ({ rows: [] })),
  };
}

// 固定候选文件（确保入队分支一定触发）
const MOCK_CANDIDATES = ['packages/brain/src/drain.js'];

beforeEach(() => {
  capturedBodies = [];
  // Mock scanMissingTestFiles 返回固定候选文件，避免因文件系统全覆盖而跳过
  vi.spyOn(codexTestGenModule, 'scanMissingTestFiles').mockResolvedValue(MOCK_CANDIDATES);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// 共享辅助：执行 runCodexTestGen 并返回第一个 codex_test_gen body
async function runAndCapture() {
  const globalFetch = makeMockFetch();
  vi.stubGlobal('fetch', globalFetch);
  const pool = makeMockPool();

  await codexTestGenModule.runCodexTestGen(pool, 'http://localhost:5221').catch(() => {});

  return capturedBodies.find((b) => b?.task_type === 'codex_test_gen') ?? null;
}

// ---- B-1：description 非空且含 targetFile 路径 ----

describe('[B-1] 入队 body description 非空且含 targetFile 路径', () => {
  it('description 字段存在且非空字符串', async () => {
    const postedBody = await runAndCapture();

    expect(postedBody, '应有 codex_test_gen 任务入队').not.toBeNull();
    expect(postedBody.description, 'description 字段应存在').toBeDefined();
    expect(postedBody.description, 'description 不应为空字符串').not.toBe('');
    expect(postedBody.description, 'description 不应为 null').not.toBeNull();
  });

  it('description 含 target_file 路径字符串', async () => {
    const postedBody = await runAndCapture();

    expect(postedBody, '应有 codex_test_gen 任务入队').not.toBeNull();

    // target_file 路径应出现在 description 中（INV-1）
    const targetFile = postedBody.payload?.target_file;
    expect(targetFile, 'payload.target_file 应存在').toBeDefined();
    expect(postedBody.description, `description 应含 target_file: ${targetFile}`).toContain(targetFile);
  });
});

// ---- B-2：description 长度 >= 20 ----

describe('[B-2] description 长度 >= 20 字符（INV-2）', () => {
  it('description.trim().length >= 20', async () => {
    const postedBody = await runAndCapture();

    expect(postedBody, '应有 codex_test_gen 任务入队').not.toBeNull();

    const desc = (postedBody.description || '').trim();
    expect(desc.length, `description 长度 ${desc.length} < 20`).toBeGreaterThanOrEqual(20);
  });
});

// ---- B-3：payload.candidate_test_paths 非空数组 ----

describe('[B-3] payload.candidate_test_paths 为非空数组（INV-3）', () => {
  it('candidate_test_paths 存在且为数组', async () => {
    const postedBody = await runAndCapture();

    expect(postedBody, '应有 codex_test_gen 任务入队').not.toBeNull();

    expect(Array.isArray(postedBody.payload?.candidate_test_paths),
      'candidate_test_paths 应为数组').toBe(true);
    expect(postedBody.payload.candidate_test_paths.length,
      'candidate_test_paths 不应为空数组').toBeGreaterThan(0);
  });

  it('candidate_test_paths 元素含 .test.js 后缀', async () => {
    const postedBody = await runAndCapture();

    expect(postedBody, '应有 codex_test_gen 任务入队').not.toBeNull();

    const paths = postedBody.payload?.candidate_test_paths || [];
    const allHaveTestSuffix = paths.every((p) => p.endsWith('.test.js'));
    expect(allHaveTestSuffix, `所有路径应以 .test.js 结尾，实际: ${paths}`).toBe(true);
  });
});

// ---- B-4：priority 为合法值 P2 ----

describe('[B-4] priority 为合法值 P2（INV-5）', () => {
  it('priority === "P2"（不再是非法的 P3）', async () => {
    const postedBody = await runAndCapture();

    expect(postedBody, '应有 codex_test_gen 任务入队').not.toBeNull();

    const validPriorities = ['P0', 'P1', 'P2'];
    expect(validPriorities).toContain(postedBody.priority);
    expect(postedBody.priority, '应为 P2').toBe('P2');
  });
});

// ---- B-2+B-4 联合：description 含 vitest 关键词（INV-4）----

describe('[B-2+B-4 联合] description 含 vitest 关键词（INV-4）', () => {
  it('description 含字符串 "vitest"', async () => {
    const postedBody = await runAndCapture();

    expect(postedBody, '应有 codex_test_gen 任务入队').not.toBeNull();

    expect(
      (postedBody.description || '').toLowerCase(),
      'description 应含 vitest 关键词'
    ).toContain('vitest');
  });
});
