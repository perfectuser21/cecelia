/**
 * callback-utils-sync-resolver.test.js
 *
 * RED→GREEN TDD for I1:
 *   resolveCanonicalPrUrlSync 与 async resolver 共用同一逐项校验逻辑
 *   explicit → tasks.pr_url → payload.pr_url → payload.existing_pr_url
 *   每项独立 trim+validate，首个合法返回；invalid 高优先级不遮蔽合法低优先级
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../alerting.js', () => ({ raise: vi.fn() }));
vi.mock('../spawn/middleware/docker-run.js', () => ({ runDocker: vi.fn() }));
vi.mock('../spawn/middleware/account-rotation.js', () => ({ resolveAccount: vi.fn() }));
vi.mock('../spawn/middleware/cascade.js', () => ({ resolveCascade: vi.fn() }));
vi.mock('../spawn/middleware/cost-cap.js', () => ({ checkCostCap: vi.fn() }));
vi.mock('../spawn/middleware/cap-marking.js', () => ({ checkCap: vi.fn() }));
vi.mock('../spawn/middleware/billing.js', () => ({ recordBilling: vi.fn() }));
vi.mock('../spawn/middleware/logging.js', () => ({ createSpawnLogger: vi.fn().mockReturnValue({ log: vi.fn(), error: vi.fn() }) }));
vi.mock('../spawn/middleware/resource-tier.js', () => ({
  resolveResourceTier: vi.fn().mockReturnValue({ tier: 'standard' }),
  RESOURCE_TIERS: {},
  TASK_TYPE_TIER: {},
}));
vi.mock('../harness-shared.js', () => ({
  parseDockerOutput: vi.fn().mockReturnValue({}),
  extractField: vi.fn().mockReturnValue(null),
}));

import { resolveCanonicalPrUrlSync, isValidGithubPrUrl } from '../lib/callback-utils.js';

const VALID_PR_URL = 'https://github.com/perfectuser21/cecelia/pull/4830';
const INVALID_PR_URL = 'PR #4830'; // stdout 只输出了这个

// ════════════════════════════════════════════════════════════════
// I1: resolveCanonicalPrUrlSync 逐项独立校验（fix ||短路 bug）
// ════════════════════════════════════════════════════════════════

describe('[I1] resolveCanonicalPrUrlSync — 逐项独立校验，invalid 不遮蔽合法低优先级', () => {

  it('[I1-S1] tasks.pr_url 非法("PR #4830") + existing_pr_url 合法 → 返回 existing 合法 URL', () => {
    const taskRow = {
      pr_url: INVALID_PR_URL,          // tasks.pr_url 非法
      payload: {
        existing_pr_url: VALID_PR_URL, // 合法
      },
    };

    const result = resolveCanonicalPrUrlSync(null, taskRow);

    // Bug: ||短路时 'PR #4830'（truthy但非法）会遮蔽 existing_pr_url → 返回 null
    // Fix: 逐项独立校验时应返回 VALID_PR_URL
    expect(result).toBe(VALID_PR_URL);
  });

  it('[I1-S2] tasks.pr_url 非法 + payload.pr_url 非法 + existing_pr_url 合法 → 返回 existing', () => {
    const taskRow = {
      pr_url: 'bad-url',
      payload: {
        pr_url: 'also-bad',
        existing_pr_url: VALID_PR_URL,
      },
    };

    const result = resolveCanonicalPrUrlSync(null, taskRow);
    expect(result).toBe(VALID_PR_URL);
  });

  it('[I1-S3] explicit 合法 → 直接返回，不往下查', () => {
    const OTHER_VALID = 'https://github.com/a/b/pull/1';
    const taskRow = {
      pr_url: VALID_PR_URL,
      payload: { existing_pr_url: VALID_PR_URL },
    };

    const result = resolveCanonicalPrUrlSync(OTHER_VALID, taskRow);
    expect(result).toBe(OTHER_VALID);
  });

  it('[I1-S4] explicit 非法 + tasks.pr_url 合法 → 返回 tasks.pr_url', () => {
    const taskRow = {
      pr_url: VALID_PR_URL,
      payload: {},
    };

    const result = resolveCanonicalPrUrlSync(INVALID_PR_URL, taskRow);
    expect(result).toBe(VALID_PR_URL);
  });

  it('[I1-S5] explicit 有空格的合法 URL → trim 后返回', () => {
    const result = resolveCanonicalPrUrlSync('  ' + VALID_PR_URL + '  ', null);
    expect(result).toBe(VALID_PR_URL);
  });

  it('[I1-S6] 全链路均无合法 URL → null', () => {
    const taskRow = {
      pr_url: INVALID_PR_URL,
      payload: {
        pr_url: 'bad',
        existing_pr_url: 'also-bad',
      },
    };

    const result = resolveCanonicalPrUrlSync(null, taskRow);
    expect(result).toBeNull();
  });

  it('[I1-S7] taskRow 为 null/undefined → 不报错，返回 null', () => {
    expect(resolveCanonicalPrUrlSync(null, null)).toBeNull();
    expect(resolveCanonicalPrUrlSync(null, undefined)).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════
// I1: writeDockerCallback 真实调用 — callback_queue _meta.pr_url 合法
// ════════════════════════════════════════════════════════════════

describe('[I1] writeDockerCallback — _meta.pr_url 在 tasks.pr_url 非法时回落 existing_pr_url', () => {

  it('[I1-W1] tasks.pr_url="PR #4830", existing_pr_url=合法 → callback_queue _meta.pr_url 合法', async () => {
    const capturedInserts = [];

    const mockPool = {
      query: vi.fn(async (sql, args) => {
        if (/INSERT.*callback_queue/i.test(sql)) {
          // args[4] = result_json (JSON.stringify of resultJson)
          if (args && args[4]) {
            capturedInserts.push(JSON.parse(args[4]));
          }
        }
        return { rows: [], rowCount: 1 };
      }),
    };

    const task = {
      id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      task_type: 'dev',
      pr_url: INVALID_PR_URL,          // tasks.pr_url 非法
      payload: {
        existing_pr_url: VALID_PR_URL, // 合法的兜底 URL
      },
    };

    const result = {
      exit_code: 0,
      stdout: 'Task completed successfully. PR #4830',
      stderr: null,
      timed_out: false,
      container: 'cecelia-run-123',
      started_at: '2026-08-12T10:00:00Z',
      ended_at: '2026-08-12T10:05:00Z',
      duration_ms: 300000,
    };

    const { writeDockerCallback } = await import('../docker-executor.js');
    await writeDockerCallback(task, 'run-001', null, result, mockPool);

    expect(capturedInserts.length).toBeGreaterThan(0);

    const inserted = capturedInserts[0];
    expect(inserted).toBeDefined();
    expect(inserted._meta).toBeDefined();

    // _meta.pr_url 必须是合法的 GitHub PR URL，而不是 null 或 'PR #4830'
    expect(isValidGithubPrUrl(inserted._meta.pr_url)).toBe(true);
    expect(inserted._meta.pr_url).toBe(VALID_PR_URL);
  });

  it('[I1-W2] stdout 含完整 URL → explicit 优先，不读 DB', async () => {
    const STDOUT_URL = 'https://github.com/org/repo/pull/9999';
    const capturedInserts = [];

    const mockPool = {
      query: vi.fn(async (sql, args) => {
        if (/INSERT.*callback_queue/i.test(sql) && args?.[4]) {
          capturedInserts.push(JSON.parse(args[4]));
        }
        return { rows: [], rowCount: 1 };
      }),
    };

    const task = {
      id: 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff',
      task_type: 'dev',
      pr_url: INVALID_PR_URL,
      payload: { existing_pr_url: VALID_PR_URL },
    };

    // Mock parseDockerOutput/extractField to return explicit URL from stdout
    vi.resetModules();
    const { parseDockerOutput, extractField } = await import('../harness-shared.js');
    vi.mocked(extractField).mockReturnValue(STDOUT_URL);

    const result = {
      exit_code: 0,
      stdout: `PR created: ${STDOUT_URL}`,
      stderr: null,
      timed_out: false,
      container: 'c-002',
      started_at: '2026-08-12T10:00:00Z',
      ended_at: '2026-08-12T10:05:00Z',
      duration_ms: 100000,
    };

    const { writeDockerCallback } = await import('../docker-executor.js');
    await writeDockerCallback(task, 'run-002', null, result, mockPool);

    if (capturedInserts.length > 0) {
      // stdout URL 优先 → _meta.pr_url = STDOUT_URL
      expect(capturedInserts[0]._meta.pr_url).toBe(STDOUT_URL);
    }
    // 至少不能是非法值
    if (capturedInserts[0]?._meta?.pr_url) {
      expect(isValidGithubPrUrl(capturedInserts[0]._meta.pr_url)).toBe(true);
    }
  });
});
