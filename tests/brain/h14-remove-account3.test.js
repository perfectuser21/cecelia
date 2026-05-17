// SPDX-License-Identifier: MIT
// Test for H14: ACCOUNTS / CLAUDE_ACCOUNTS hardcoded 数组移除 'account3'。
// W8 v15 实测：account3 订阅退订 → claude CLI 403 → graph fail。

import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

function loadSrc(rel) {
  return readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

describe('H14 — 3 src 文件 ACCOUNTS 数组移除 account3', () => {
  test('account-usage.js ACCOUNTS 不含 account3', () => {
    const src = loadSrc('packages/brain/src/account-usage.js');
    // ACCOUNTS 数组那行
    const m = src.match(/const ACCOUNTS\s*=\s*\[([^\]]+)\]/);
    expect(m).toBeTruthy();
    expect(m[1]).not.toContain('account3');
    expect(m[1]).toContain('account1');
    expect(m[1]).toContain('account2');
  });

  test('credentials-health-scheduler.js CLAUDE_ACCOUNTS 不含 account3', () => {
    const src = loadSrc('packages/brain/src/credentials-health-scheduler.js');
    const m = src.match(/const CLAUDE_ACCOUNTS\s*=\s*\[([^\]]+)\]/);
    expect(m).toBeTruthy();
    expect(m[1]).not.toContain('account3');
    expect(m[1]).toContain('account1');
    expect(m[1]).toContain('account2');
  });

  test('credential-expiry-checker.js ACCOUNTS 不含 account3', () => {
    const src = loadSrc('packages/brain/src/credential-expiry-checker.js');
    const m = src.match(/const ACCOUNTS\s*=\s*\[([^\]]+)\]/);
    expect(m).toBeTruthy();
    expect(m[1]).not.toContain('account3');
    expect(m[1]).toContain('account1');
    expect(m[1]).toContain('account2');
  });
});
