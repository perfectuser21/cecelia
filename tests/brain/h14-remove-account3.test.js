// SPDX-License-Identifier: MIT
// Regression test for ACCOUNTS / CLAUDE_ACCOUNTS hardcoded 数组。
//
// 历史：
//   H14（cp-0510075509）：account3 订阅退订 → claude CLI 403 → 移除 account3，列表 = [account1, account2]。
//   B51（cp-0601200454）：account1 缺 .credentials.json 永久 AUTH_FAILED，account3 凭据已恢复有效。
//     → 列表修正为 [account2, account3]，account1 退订。
//
// 本回归测试守护 B51 的最终策略：三处 ACCOUNTS 数组必须一致 = [account2, account3]，
// 即 account1 已移除、account2 + account3 均在列。

import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

function loadSrc(rel) {
  return readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

describe('B51 — 3 src 文件 ACCOUNTS 数组 = [account2, account3]', () => {
  test('account-usage.js ACCOUNTS 移除 account1，含 account2 + account3', () => {
    const src = loadSrc('packages/brain/src/account-usage.js');
    const m = src.match(/const ACCOUNTS\s*=\s*\[([^\]]+)\]/);
    expect(m).toBeTruthy();
    expect(m[1]).not.toContain('account1');
    expect(m[1]).toContain('account2');
    expect(m[1]).toContain('account3');
  });

  test('credentials-health-scheduler.js CLAUDE_ACCOUNTS 移除 account1，含 account2 + account3', () => {
    const src = loadSrc('packages/brain/src/credentials-health-scheduler.js');
    const m = src.match(/const CLAUDE_ACCOUNTS\s*=\s*\[([^\]]+)\]/);
    expect(m).toBeTruthy();
    expect(m[1]).not.toContain('account1');
    expect(m[1]).toContain('account2');
    expect(m[1]).toContain('account3');
  });

  test('credential-expiry-checker.js ACCOUNTS 移除 account1，含 account2 + account3', () => {
    const src = loadSrc('packages/brain/src/credential-expiry-checker.js');
    const m = src.match(/const ACCOUNTS\s*=\s*\[([^\]]+)\]/);
    expect(m).toBeTruthy();
    expect(m[1]).not.toContain('account1');
    expect(m[1]).toContain('account2');
    expect(m[1]).toContain('account3');
  });
});
