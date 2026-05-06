import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

// 测试相对仓库根目录的路径，sprints/tests/ws1/ → ../../.. = repo root
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const TICK_PATH = resolve(REPO_ROOT, 'packages/brain/src/tick.js');

function readTick(): string {
  return readFileSync(TICK_PATH, 'utf8');
}

describe('Workstream 1 — tick.js 单位注释 [BEHAVIOR]', () => {
  it('TICK_LOOP_INTERVAL_MS 第一处出现行的 ±2 行窗口内存在含「毫秒|ms」与常量名的 // 注释', () => {
    const lines = readTick().split('\n');
    const idx = lines.findIndex((l) => /TICK_LOOP_INTERVAL_MS/.test(l));
    expect(idx, '应能找到 TICK_LOOP_INTERVAL_MS 第一处出现').toBeGreaterThanOrEqual(0);
    expect(idx, '第一处出现应位于 import 块（行号 < 100）').toBeLessThan(100);

    const start = Math.max(0, idx - 2);
    const end = Math.min(lines.length, idx + 3); // slice 右开
    const window = lines.slice(start, end);

    const hit = window.find(
      (l) => /^\s*\/\//.test(l) && /(毫秒|ms|MS)/.test(l) && /TICK_LOOP_INTERVAL_MS/.test(l)
    );
    expect(
      hit,
      `5 行窗口内未发现说明 TICK_LOOP_INTERVAL_MS 单位的 // 注释。窗口:\n${window.join('\n')}`
    ).toBeTruthy();
  });

  it('文件末尾 export { ... } 名单仍 re-export TICK_LOOP_INTERVAL_MS', () => {
    const c = readTick();
    expect(c).toMatch(/export\s*\{[\s\S]*?TICK_LOOP_INTERVAL_MS[\s\S]*?\}/m);
  });

  it('import 块内三个常量顺序仍为 MINUTES → LOOP_INTERVAL_MS → TIMEOUT_MS', () => {
    const c = readTick();
    const m = c.match(/from\s+["']\.\/tick-loop\.js["']/);
    expect(m, '应能找到 from "./tick-loop.js" 的 import').toBeTruthy();

    const head = c.slice(0, m!.index!);
    const lastImport = head.lastIndexOf('import');
    expect(lastImport).toBeGreaterThanOrEqual(0);
    const importBlock = c.slice(lastImport, m!.index!);

    const a = importBlock.indexOf('TICK_INTERVAL_MINUTES');
    const b = importBlock.indexOf('TICK_LOOP_INTERVAL_MS');
    const d = importBlock.indexOf('TICK_TIMEOUT_MS');

    expect(a).toBeGreaterThanOrEqual(0);
    expect(b).toBeGreaterThanOrEqual(0);
    expect(d).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(d);
  });

  it('tick.js 通过 node --check 静态语法校验', () => {
    expect(() => execSync(`node --check "${TICK_PATH}"`, { stdio: 'pipe' })).not.toThrow();
  });
});
