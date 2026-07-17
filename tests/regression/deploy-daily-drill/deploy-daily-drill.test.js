/**
 * G3 每日部署演习 — JS wrapper tests（CI check-test-coverage.cjs 需要 .test.js 含 it() 块）
 *
 * 通过子进程调用真实的 deploy-daily-drill.sh bash 脚本，
 * 用环境变量注入 fixture，不 mock 脚本内部逻辑。
 *
 * BEHAVIOR 覆盖：
 *   B2: merge 后 15min 内无 deploy run → exit 1（演习红）
 *   B3: GH API 不可达 → exit 2（fail open）
 *   B4: 无 merge 的日子 → exit 2 + no_merge_skip
 *   B7: deploy-daily-drill.sh 存在（初始 Red commit 时此 it 失败）
 */

import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

// 路径按 repo root 解析，兼容任意 cwd（brain vitest cwd=packages/brain）
// 文件位于 tests/regression/deploy-daily-drill/，需上 4 级才到 repo root
const ROOT = resolve(fileURLToPath(import.meta.url), '../../../..');
const SCRIPT = resolve(ROOT, 'scripts/smoke/e2e/deploy-daily-drill.sh');

function runDrill(env = {}) {
  try {
    const result = execSync(`bash "${SCRIPT}"`, {
      env: { ...process.env, ...env },
      encoding: 'utf8',
      timeout: 10000,
    });
    return { code: 0, stdout: result };
  } catch (err) {
    return { code: err.status ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

describe('deploy-daily-drill.sh — G3 每日演习对账', () => {
  it('B7: deploy-daily-drill.sh 存在（Red commit 时此用例失败）', () => {
    expect(existsSync(SCRIPT)).toBe(true);
  });

  it('B2: merge 后 15min 内无 deploy run → exit 1（演习红）', () => {
    const mockMerges = JSON.stringify([{
      number: 9999,
      merge_commit_sha: 'abc1234deadbeef',
      merged_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      title: 'test PR B2',
    }]);
    const mockRuns = JSON.stringify([]);
    const result = runDrill({ DRILL_MOCK_MERGES: mockMerges, DRILL_MOCK_RUNS: mockRuns });
    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(/DRILL_RED/);
  });

  it('B3: GH API 不可达 → exit 2 fail open（不假红）', () => {
    const result = runDrill({ DRILL_GH_API_FAIL: '1' });
    expect(result.code).toBe(2);
    expect(result.stdout).toMatch(/gh_api_error|skip/);
  });

  it('B4: 无 merge 的日子 → exit 2 + stdout 含 no_merge_skip', () => {
    const result = runDrill({ DRILL_MOCK_MERGES: '[]' });
    expect(result.code).toBe(2);
    expect(result.stdout).toMatch(/no_merge_skip/);
  });
});
