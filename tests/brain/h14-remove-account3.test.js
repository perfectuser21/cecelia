// SPDX-License-Identifier: MIT
// Regression test for ACCOUNTS / CLAUDE_ACCOUNTS hardcoded 数组。
//
// 历史：
//   H14（cp-0510075509）：account3 订阅退订 → claude CLI 403 → 移除 account3，列表 = [account1, account2]。
//   B51（cp-0601200454）：以"account1 缺凭据、account3 凭据恢复"为由改为 [account2, account3]。
//   B53（cp-0602131500）：account3 的 org 订阅禁用了 Claude Code（spawn 返 403 organization disabled），
//     实测 planner 被派 account3 秒退 exit 1、harness 卡死。org 禁用 ≠ 凭据失效，B51 前提错误。
//     account1 仍无凭据。→ 列表收敛为 [account2]，account1 + account3 均移除。
//
// 本回归测试守护 B53 策略：三处 ACCOUNTS 数组必须一致 = [account2]，
// 即 account1（无凭据）和 account3（org 禁用）都不得出现在调度池里。

import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

function loadSrc(rel) {
  return readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

describe('B53 — 3 src 文件 ACCOUNTS 数组 = [account2]（account3 org 禁用已移出）', () => {
  test('account-usage.js ACCOUNTS 仅 account2（不含 account1/account3）', () => {
    const src = loadSrc('packages/brain/src/account-usage.js');
    const m = src.match(/const ACCOUNTS\s*=\s*\[([^\]]+)\]/);
    expect(m).toBeTruthy();
    expect(m[1]).not.toContain('account1');
    expect(m[1]).not.toContain('account3');
    expect(m[1]).toContain('account2');
  });

  test('credentials-health-scheduler.js CLAUDE_ACCOUNTS 仅 account2（不含 account1/account3）', () => {
    const src = loadSrc('packages/brain/src/credentials-health-scheduler.js');
    const m = src.match(/const CLAUDE_ACCOUNTS\s*=\s*\[([^\]]+)\]/);
    expect(m).toBeTruthy();
    expect(m[1]).not.toContain('account1');
    expect(m[1]).not.toContain('account3');
    expect(m[1]).toContain('account2');
  });

  test('credential-expiry-checker.js ACCOUNTS 仅 account2（不含 account1/account3）', () => {
    const src = loadSrc('packages/brain/src/credential-expiry-checker.js');
    const m = src.match(/const ACCOUNTS\s*=\s*\[([^\]]+)\]/);
    expect(m).toBeTruthy();
    expect(m[1]).not.toContain('account1');
    expect(m[1]).not.toContain('account3');
    expect(m[1]).toContain('account2');
  });
});
