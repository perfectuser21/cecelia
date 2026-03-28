/**
 * tests/scripts/write-current-state.test.ts
 *
 * 验证 write-current-state.sh 脚本的基本属性：
 * - 文件存在且包含必要的 Brain API 调用
 * - 包含 Brain 离线静默跳过逻辑
 * - Stage 4 文件包含对该脚本的调用
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const REPO_ROOT = resolve(__dirname, '../../../..');

describe('write-current-state.sh', () => {
  const scriptPath = resolve(REPO_ROOT, 'scripts/write-current-state.sh');

  it('脚本文件存在', () => {
    expect(existsSync(scriptPath)).toBe(true);
  });

  it('脚本包含 Brain health API 查询', () => {
    const content = readFileSync(scriptPath, 'utf-8');
    expect(content).toContain('/api/brain/health');
  });

  it('脚本包含 capability probe 查询', () => {
    const content = readFileSync(scriptPath, 'utf-8');
    expect(content).toContain('probes/status');
  });

  it('脚本包含 in_progress 任务查询', () => {
    const content = readFileSync(scriptPath, 'utf-8');
    expect(content).toContain('in_progress');
  });

  it('脚本包含 Brain 离线静默退出逻辑（exit 0）', () => {
    const content = readFileSync(scriptPath, 'utf-8');
    expect(content).toContain('exit 0');
  });

  it('脚本输出目标为 CURRENT_STATE.md', () => {
    const content = readFileSync(scriptPath, 'utf-8');
    expect(content).toContain('CURRENT_STATE.md');
  });

  it('Stage 4 文件包含 write-current-state.sh 调用', () => {
    const stage4Path = resolve(REPO_ROOT, 'packages/engine/skills/dev/steps/04-ship.md');
    const content = readFileSync(stage4Path, 'utf-8');
    expect(content).toContain('write-current-state.sh');
  });
});
