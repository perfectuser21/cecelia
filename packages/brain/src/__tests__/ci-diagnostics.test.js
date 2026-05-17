/**
 * ci-diagnostics 单元测试
 *
 * 覆盖 parseCiFailureLogs（7 种类别）、extractPrInfo、diagnoseCiFailure（依赖注入）
 */

import { describe, it, expect, vi } from 'vitest';
import {
  CI_FAILURE_CLASS,
  parseCiFailureLogs,
  extractPrInfo,
  diagnoseCiFailure,
} from '../ci-diagnostics.js';

// ============================================================
// parseCiFailureLogs
// ============================================================

describe('parseCiFailureLogs - test_failure', () => {
  it('识别 vitest FAIL 输出', () => {
    const log = 'FAIL packages/brain/src/__tests__/tick.test.js\n expected 5 received 10';
    const result = parseCiFailureLogs(log);
    expect(result.failure_class).toBe(CI_FAILURE_CLASS.TEST_FAILURE);
    expect(result.retryable).toBe(false);
    expect(result.patterns_matched.length).toBeGreaterThan(0);
  });

  it('识别 N tests failed', () => {
    const log = '3 tests failed in packages/brain';
    const result = parseCiFailureLogs(log);
    expect(result.failure_class).toBe(CI_FAILURE_CLASS.TEST_FAILURE);
    expect(result.retryable).toBe(false);
  });

  it('识别 AssertionError', () => {
    const log = 'AssertionError: expected true to equal false';
    const result = parseCiFailureLogs(log);
    expect(result.failure_class).toBe(CI_FAILURE_CLASS.TEST_FAILURE);
  });

  it('识别 expected ... received', () => {
    const log = 'expected "hello" received "world"';
    const result = parseCiFailureLogs(log);
    expect(result.failure_class).toBe(CI_FAILURE_CLASS.TEST_FAILURE);
  });
});

describe('parseCiFailureLogs - type_error', () => {
  it('识别 TypeScript TS 错误码', () => {
    const log = "error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.";
    const result = parseCiFailureLogs(log);
    expect(result.failure_class).toBe(CI_FAILURE_CLASS.TYPE_ERROR);
    expect(result.retryable).toBe(false);
  });

  it('识别 tsc error', () => {
    const log = 'TypeScript error: compilation failed with 3 errors';
    const result = parseCiFailureLogs(log);
    expect(result.failure_class).toBe(CI_FAILURE_CLASS.TYPE_ERROR);
  });

  it('识别 ESLint error', () => {
    const log = '5 errors found in packages/brain/src/routes.js\neslint error: no-unused-vars';
    const result = parseCiFailureLogs(log);
    expect(result.failure_class).toBe(CI_FAILURE_CLASS.TYPE_ERROR);
  });
});

describe('parseCiFailureLogs - missing_dep', () => {
  it('识别 Cannot find module', () => {
    const log = "Cannot find module '@/utils/helper' from 'src/index.js'";
    const result = parseCiFailureLogs(log);
    expect(result.failure_class).toBe(CI_FAILURE_CLASS.MISSING_DEP);
    expect(result.retryable).toBe(false);
  });

  it('识别 Module not found', () => {
    const log = 'Module not found: Error: Can\'t resolve \'lodash\'';
    const result = parseCiFailureLogs(log);
    expect(result.failure_class).toBe(CI_FAILURE_CLASS.MISSING_DEP);
  });

  it('识别 npm ERR! missing', () => {
    const log = 'npm ERR! missing: express@^4.18.0, required by my-app@1.0.0';
    const result = parseCiFailureLogs(log);
    expect(result.failure_class).toBe(CI_FAILURE_CLASS.MISSING_DEP);
  });
});

describe('parseCiFailureLogs - version_mismatch', () => {
  it('识别 check-version-sync', () => {
    const log = 'check-version-sync: FAIL - package.json says 1.2.3 but VERSION says 1.2.2';
    const result = parseCiFailureLogs(log);
    expect(result.failure_class).toBe(CI_FAILURE_CLASS.VERSION_MISMATCH);
    expect(result.retryable).toBe(false);
  });

  it('识别 version mismatch 字样', () => {
    const log = 'Error: version mismatch detected between package.json and .brain-versions';
    const result = parseCiFailureLogs(log);
    expect(result.failure_class).toBe(CI_FAILURE_CLASS.VERSION_MISMATCH);
  });

  it('version_mismatch 优先于 test_failure', () => {
    const log = 'check-version-sync failed\nFAIL packages/brain/src/__tests__/version.test.js';
    const result = parseCiFailureLogs(log);
    expect(result.failure_class).toBe(CI_FAILURE_CLASS.VERSION_MISMATCH);
  });
});

describe('parseCiFailureLogs - timeout', () => {
  it('识别 exit code 124', () => {
    const log = 'Process exited with exit code 124 (timeout)';
    const result = parseCiFailureLogs(log);
    expect(result.failure_class).toBe(CI_FAILURE_CLASS.TIMEOUT);
    expect(result.retryable).toBe(true);
  });

  it('识别 timed out', () => {
    const log = 'The job running on runner GitHub Actions 2 exceeded the maximum execution time of 60 minutes.';
    const result = parseCiFailureLogs(log);
    expect(result.failure_class).toBe(CI_FAILURE_CLASS.TIMEOUT);
    expect(result.retryable).toBe(true);
  });
});

describe('parseCiFailureLogs - flaky', () => {
  it('识别 ECONNRESET', () => {
    const log = 'Error: ECONNRESET - connection reset by peer';
    const result = parseCiFailureLogs(log);
    expect(result.failure_class).toBe(CI_FAILURE_CLASS.FLAKY);
    expect(result.retryable).toBe(true);
  });

  it('识别 runner unavailable', () => {
    const log = 'runner unavailable, waiting for runners to be available';
    const result = parseCiFailureLogs(log);
    expect(result.failure_class).toBe(CI_FAILURE_CLASS.FLAKY);
    expect(result.retryable).toBe(true);
  });

  it('识别 rate limit', () => {
    const log = 'secondary rate limit exceeded, retrying after 60 seconds';
    const result = parseCiFailureLogs(log);
    expect(result.failure_class).toBe(CI_FAILURE_CLASS.FLAKY);
  });
});

describe('parseCiFailureLogs - unknown', () => {
  it('无法识别的日志返回 unknown', () => {
    const log = 'something completely unrecognized happened xyz987';
    const result = parseCiFailureLogs(log);
    expect(result.failure_class).toBe(CI_FAILURE_CLASS.UNKNOWN);
    expect(result.retryable).toBe(false);
    expect(result.patterns_matched).toHaveLength(0);
  });

  it('空字符串返回 unknown', () => {
    const result = parseCiFailureLogs('');
    expect(result.failure_class).toBe(CI_FAILURE_CLASS.UNKNOWN);
  });

  it('null 返回 unknown', () => {
    const result = parseCiFailureLogs(null);
    expect(result.failure_class).toBe(CI_FAILURE_CLASS.UNKNOWN);
  });

  it('返回结果包含 excerpt', () => {
    const log = 'some log output here';
    const result = parseCiFailureLogs(log);
    expect(result.excerpt).toBe(log);
  });
});

describe('parseCiFailureLogs - excerpt 截断', () => {
  it('excerpt 最多 500 字符', () => {
    const log = 'x'.repeat(1000);
    const result = parseCiFailureLogs(log);
    expect(result.excerpt.length).toBe(500);
  });
});

// ============================================================
// extractPrInfo
// ============================================================

describe('extractPrInfo', () => {
  it('提取 owner/repo/prNumber', () => {
    const result = extractPrInfo('https://github.com/perfectuser21/cecelia/pull/605');
    expect(result).toEqual({ owner: 'perfectuser21', repo: 'cecelia', prNumber: '605' });
  });

  it('空字符串返回 null', () => {
    expect(extractPrInfo('')).toBeNull();
  });

  it('null 返回 null', () => {
    expect(extractPrInfo(null)).toBeNull();
  });

  it('非 GitHub URL 返回 null', () => {
    expect(extractPrInfo('https://example.com/pr/123')).toBeNull();
  });

  it('大小写不敏感', () => {
    const result = extractPrInfo('https://GITHUB.com/Owner/Repo/pull/42');
    expect(result).toEqual({ owner: 'Owner', repo: 'Repo', prNumber: '42' });
  });
});

// ============================================================
// diagnoseCiFailure - 依赖注入测试
// ============================================================

describe('diagnoseCiFailure', () => {
  const prUrl = 'https://github.com/perfectuser21/cecelia/pull/605';

  it('调用 execFn 两次（run list + run view）', async () => {
    const execFn = vi.fn()
      .mockResolvedValueOnce(JSON.stringify([{ databaseId: 12345 }]))
      .mockResolvedValueOnce('FAIL packages/brain/src/__tests__/tick.test.js\n2 tests failed');

    await diagnoseCiFailure({ prUrl }, { execFn });

    expect(execFn).toHaveBeenCalledTimes(2);
    expect(execFn.mock.calls[0][0]).toContain('gh run list');
    expect(execFn.mock.calls[0][0]).toContain('--pr 605');
    expect(execFn.mock.calls[1][0]).toContain('gh run view 12345');
    expect(execFn.mock.calls[1][0]).toContain('--log-failed');
  });

  it('正确识别 test_failure', async () => {
    const execFn = vi.fn()
      .mockResolvedValueOnce(JSON.stringify([{ databaseId: 99 }]))
      .mockResolvedValueOnce('FAIL packages/brain/src/__tests__/routes.test.js\nassert expected 200 got 500');

    const result = await diagnoseCiFailure({ prUrl }, { execFn });

    expect(result.failure_class).toBe(CI_FAILURE_CLASS.TEST_FAILURE);
    expect(result.retryable).toBe(false);
    expect(result.suggested_fix).toContain('测试');
    expect(result.raw_log_excerpt).toBeDefined();
    expect(result.run_id).toBe('99');
  });

  it('无 prUrl 时返回 null', async () => {
    const execFn = vi.fn();
    const result = await diagnoseCiFailure({}, { execFn });
    expect(result).toBeNull();
    expect(execFn).not.toHaveBeenCalled();
  });

  it('无 failed runs 时返回 null', async () => {
    const execFn = vi.fn().mockResolvedValueOnce('[]');
    const result = await diagnoseCiFailure({ prUrl }, { execFn });
    expect(result).toBeNull();
  });

  it('gh 命令抛出错误时优雅降级返回 null', async () => {
    const execFn = vi.fn().mockRejectedValueOnce(new Error('gh: command not found'));
    const result = await diagnoseCiFailure({ prUrl }, { execFn });
    expect(result).toBeNull();
  });

  it('结果包含 summary 和 suggested_fix', async () => {
    const execFn = vi.fn()
      .mockResolvedValueOnce(JSON.stringify([{ databaseId: 777 }]))
      .mockResolvedValueOnce('check-version-sync: FAIL - versions differ');

    const result = await diagnoseCiFailure({ prUrl }, { execFn });

    expect(result.failure_class).toBe(CI_FAILURE_CLASS.VERSION_MISMATCH);
    expect(result.summary).toContain('version_mismatch');
    expect(result.suggested_fix).toContain('版本号');
  });

  it('execFn 使用正确的 repo（owner/repo）', async () => {
    const execFn = vi.fn()
      .mockResolvedValueOnce(JSON.stringify([{ databaseId: 1 }]))
      .mockResolvedValueOnce('ECONNRESET');

    await diagnoseCiFailure(
      { prUrl: 'https://github.com/myorg/myrepo/pull/7' },
      { execFn }
    );

    expect(execFn.mock.calls[0][0]).toContain('myorg/myrepo');
    expect(execFn.mock.calls[1][0]).toContain('myorg/myrepo');
  });
});
