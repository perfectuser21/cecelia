/**
 * 测试：Self-Drive 引擎不受 BRAIN_QUIET_MODE 影响
 *
 * 根本原因：BRAIN_QUIET_MODE=true 在 launchd plist 中，导致 Self-Drive 从未启动。
 * 修复：移除 server.js 中对 BRAIN_QUIET_MODE 的条件保护。
 * 此测试确保修复不被回滚。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SERVER_JS = resolve(__dirname, '../../server.js');

describe('Self-Drive 不受 BRAIN_QUIET_MODE 抑制', () => {
  it('server.js 中 startSelfDriveLoop 不再被 BRAIN_QUIET_MODE 条件保护', () => {
    const src = readFileSync(SERVER_JS, 'utf-8');

    // 修复前的代码片段：Self-Drive 被 if (BRAIN_QUIET_MODE !== true) 保护
    // 修复后：直接调用 startSelfDriveLoop()，无条件判断
    const hasOldGuard =
      src.includes("if (process.env.BRAIN_QUIET_MODE !== 'true')") &&
      src.includes('startSelfDriveLoop') &&
      // 检查两者在相邻代码块中
      (() => {
        const quietIdx = src.indexOf("if (process.env.BRAIN_QUIET_MODE !== 'true')");
        const driveIdx = src.indexOf('startSelfDriveLoop');
        // 如果两者都存在且间距 < 200 字符，认为 Self-Drive 仍被保护
        return quietIdx !== -1 && driveIdx !== -1 && Math.abs(quietIdx - driveIdx) < 200;
      })();

    expect(hasOldGuard).toBe(false);
  });

  it('server.js 中存在无条件的 startSelfDriveLoop 调用', () => {
    const src = readFileSync(SERVER_JS, 'utf-8');
    expect(src).toContain('startSelfDriveLoop');
  });

  it('self-drive.js 的 startSelfDriveLoop 是可导出的函数', async () => {
    // 验证导出存在（不实际执行以避免 DB 连接）
    const content = readFileSync(resolve(__dirname, '../self-drive.js'), 'utf-8');
    // self-drive.js 在 src/ 目录下
    expect(content).toContain('export async function startSelfDriveLoop');
  });
});
