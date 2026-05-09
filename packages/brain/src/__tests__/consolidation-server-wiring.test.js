// SPDX-License-Identifier: MIT
// Wiring test: server.js 必须独立 setInterval 跑 runDailyConsolidationIfNeeded。
// 修复 PROBE_FAIL_CONSOLIDATION 真因（tick-runner.js Wave 2 废弃后调用断点）。

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const BRAIN_PKG = resolve(import.meta.dirname, '../..');
const SERVER_PATH = resolve(BRAIN_PKG, 'server.js');
const serverContent = readFileSync(SERVER_PATH, 'utf8');

describe('server.js — runDailyConsolidationIfNeeded 接入（PROBE_FAIL_CONSOLIDATION 修复）', () => {
  it('从 ./src/consolidation.js 动态 import runDailyConsolidationIfNeeded', () => {
    expect(serverContent).toMatch(
      /const\s*\{\s*runDailyConsolidationIfNeeded\s*\}\s*=\s*await\s+import\(['"]\.\/src\/consolidation\.js['"]\)/
    );
  });

  it('启动钩子里调用 runDailyConsolidationIfNeeded(pool)', () => {
    expect(serverContent).toContain('runDailyConsolidationIfNeeded(pool)');
  });

  it('使用 setInterval 调度（独立周期，不依赖废弃 tick-runner）', () => {
    const idx = serverContent.indexOf('runDailyConsolidationIfNeeded');
    expect(idx).toBeGreaterThan(0);
    const surroundings = serverContent.slice(Math.max(0, idx - 600), idx + 600);
    expect(surroundings).toMatch(/setInterval\s*\(/);
  });

  it('启动后通过 setTimeout 触发首发（不必等首个 interval）', () => {
    const idx = serverContent.indexOf('runDailyConsolidationIfNeeded');
    const surroundings = serverContent.slice(Math.max(0, idx - 600), idx + 600);
    expect(surroundings).toMatch(/setTimeout\s*\(/);
  });

  it('调用包裹 try/catch 兜底，不阻塞启动 / 不让循环死掉', () => {
    const idx = serverContent.indexOf('runDailyConsolidationIfNeeded');
    const surroundings = serverContent.slice(Math.max(0, idx - 600), idx + 600);
    expect(surroundings).toMatch(/catch\s*\(/);
  });
});
