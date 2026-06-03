/**
 * executor-machine-registry-removed.test.js — phase 2 单元 2
 *
 * 死代码删除回归：MACHINE_REGISTRY + selectBestMachine 是死代码
 * （派发链从未调用，仅定义 + 自引用），已被 routing/resolve-executor.js 取代。
 *
 * 断言：
 *   - executor.js 源码不再定义 MACHINE_REGISTRY 常量 / selectBestMachine 函数。
 *   - executor.js 不再导出 MACHINE_REGISTRY / selectBestMachine。
 *   - selectBestBridge 仍保留（被 triggerCodexBridge 实际使用，不是死代码）。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const executorSrc = readFileSync(join(__dirname, '../executor.js'), 'utf8');

describe('executor: MACHINE_REGISTRY / selectBestMachine 死代码已删除（phase 2 单元 2）', () => {
  it('源码不再定义 MACHINE_REGISTRY 常量', () => {
    expect(executorSrc).not.toContain('const MACHINE_REGISTRY');
  });

  it('源码不再定义 selectBestMachine 函数', () => {
    expect(executorSrc).not.toContain('function selectBestMachine');
  });

  it('源码无任何 MACHINE_REGISTRY 残留引用', () => {
    expect(executorSrc).not.toContain('MACHINE_REGISTRY');
  });

  it('源码无任何 selectBestMachine 残留引用', () => {
    expect(executorSrc).not.toContain('selectBestMachine');
  });

  it('executor.js 不再导出 MACHINE_REGISTRY / selectBestMachine', async () => {
    const mod = await import('../executor.js');
    expect(mod.MACHINE_REGISTRY).toBeUndefined();
    expect(mod.selectBestMachine).toBeUndefined();
  });

  it('selectBestBridge 仍保留（codex 多 bridge 负载，非死代码）', () => {
    expect(executorSrc).toContain('selectBestBridge');
  });
});
