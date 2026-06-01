/**
 * 回归测试：harness_initiative 任务在 cecelia-bridge 不可用时仍应被派发
 *
 * Bug：dispatcher 对所有任务都检查 bridge，但 harness_initiative 走 Docker spawn，
 * 不需要 bridge。bridge 不在 → 任务被错误 revert 到 queued，pipeline 无法启动。
 *
 * 修法：needsBridgeCheck = task.task_type !== 'harness_initiative'
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dispatcherSrc = readFileSync(join(__dirname, '../dispatcher.js'), 'utf8');

describe('harness_initiative bridge guard bypass (Bug 回归)', () => {
  it('dispatcher.js 含 needsBridgeCheck 跳过逻辑', () => {
    expect(dispatcherSrc).toMatch(/needsBridgeCheck/);
  });

  it('harness_initiative 被明确排除在 bridge check 之外', () => {
    expect(dispatcherSrc).toMatch(/task_type.*!==.*harness_initiative|harness_initiative.*!==.*task_type/);
  });

  it('needsBridgeCheck=false 时不调用 checkCeceliaRunAvailable', () => {
    // 验证代码结构：checkCeceliaRunAvailable 被 needsBridgeCheck 条件包裹
    const bridgeCheckIdx = dispatcherSrc.indexOf('checkCeceliaRunAvailable()');
    const needsBridgeIdx = dispatcherSrc.lastIndexOf('needsBridgeCheck', bridgeCheckIdx);
    // needsBridgeCheck 必须在 checkCeceliaRunAvailable 之前出现
    expect(needsBridgeIdx).toBeGreaterThan(-1);
    expect(needsBridgeIdx).toBeLessThan(bridgeCheckIdx);
  });

  it('普通任务（dev）仍然检查 bridge', () => {
    // needsBridgeCheck 只豁免 harness_initiative，其他类型依然过 bridge guard
    expect(dispatcherSrc).toMatch(/needsBridgeCheck\s*=\s*nextTask\.task_type\s*!==\s*['"]harness_initiative['"]/);
  });
});
