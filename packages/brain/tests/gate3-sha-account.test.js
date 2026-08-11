/**
 * gate3-sha-account.test.js — G1 SHA 对账 Node.js 入口（TDD 门禁）
 *
 * 本文件作为 lint-tdd-commit-order 的 *.test.js 证据，
 * 代理执行 sprints/07161500-gate3-sha-truth/tests/sha-account.test.sh。
 *
 * 覆盖 BEHAVIOR-01..07（见 sprints/07161500-gate3-sha-truth/contract-dod.md）：
 *   BEHAVIOR-01: squash_merge_sha_diff — SHA 不等时必须触发部署
 *   BEHAVIOR-02: sha_equal_skip       — SHA 相等时跳过部署（幂等）
 *   BEHAVIOR-03: health_returns_git_sha — /health 返回 git_sha 字段
 *   BEHAVIOR-04: s6_sha_mismatch_rollback — 回读 SHA 不匹配走 ROLLBACK
 *   BEHAVIOR-05: workflow_no_changed_paths — changed_paths 为空时不跳过
 *   BEHAVIOR-06: health_unreachable_fail_open — /health 不可达时 fail-open
 *   BEHAVIOR-07: deploy_empty_body_not_skipped — empty body 不跳过部署
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..'); // tests/ → brain/ → packages/ → repo root
const SCRIPT = path.join(ROOT, 'tests/regression/gate3-sha-truth/sha-account.test.sh');

it('sha-account shell tests pass (BEHAVIOR-01..07)', () => {
  let exitCode = 0;
  try {
    execFileSync('bash', [SCRIPT], {
      cwd: ROOT,
      stdio: 'inherit',
      timeout: 60_000,
      // 全套测试不得把本机正在运行的 Brain 当成 fixture，更不得 POST 真实 /deploy。
      // 指向确定性的不可达端口，shell 合同会走同一源码验证分支。
      env: { ...process.env, BRAIN_URL: 'http://127.0.0.1:1' },
    });
  } catch (err) {
    exitCode = err.status ?? 1;
  }
  expect(exitCode).toBe(0);
}, 90_000);
