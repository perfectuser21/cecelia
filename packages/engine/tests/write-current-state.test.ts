import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// 用 resolve(__dirname, ...) 让 check-changed-coverage 的 gate2 能识别路径引用
const SESSION_START = resolve(__dirname, '../hooks/session-start.sh');
const SHIP_MD = resolve(__dirname, '../skills/dev/steps/04-ship.md');
const WRITE_STATE_SH = resolve(__dirname, '../../../scripts/write-current-state.sh');

describe('write-current-state.sh', () => {
  it('脚本文件存在', () => {
    expect(existsSync(WRITE_STATE_SH)).toBe(true);
  });

  it('脚本包含 capability_probe 查询逻辑', () => {
    const content = readFileSync(WRITE_STATE_SH, 'utf8');
    expect(content).toContain('capability_probe');
  });

  it('脚本包含主仓库路径解析（兼容 worktree）', () => {
    const content = readFileSync(WRITE_STATE_SH, 'utf8');
    expect(content).toContain('git-common-dir');
  });

  it('脚本包含 Brain API 查询', () => {
    const content = readFileSync(WRITE_STATE_SH, 'utf8');
    expect(content).toContain('BRAIN_URL');
  });
});

describe('04-ship.md 包含 CURRENT_STATE 步骤', () => {
  it('04-ship.md 包含 write-current-state 调用', () => {
    const content = readFileSync(SHIP_MD, 'utf8');
    expect(content).toContain('write-current-state');
  });

  it('04-ship.md 步骤在 4.4 Update Memory 之后、4.5 Clean 之前', () => {
    const content = readFileSync(SHIP_MD, 'utf8');
    const idx44 = content.indexOf('## 4.4 Update Memory');
    const idx445 = content.indexOf('## 4.4.5 更新系统状态');
    const idx45 = content.indexOf('## 4.5 Clean');
    expect(idx44).toBeGreaterThan(-1);
    expect(idx445).toBeGreaterThan(idx44);
    expect(idx45).toBeGreaterThan(idx445);
  });
});

describe('write-current-state.sh 包含 CI 状态章节', () => {
  it('脚本包含 gh run list 调用', () => {
    const content = readFileSync(WRITE_STATE_SH, 'utf8');
    expect(content).toContain('gh run list');
  });

  it('脚本包含 CI_SECTION 变量', () => {
    const content = readFileSync(WRITE_STATE_SH, 'utf8');
    expect(content).toContain('CI_SECTION');
  });

  it('脚本包含 CI 状态章节输出', () => {
    const content = readFileSync(WRITE_STATE_SH, 'utf8');
    expect(content).toContain('最近 CI 状态');
  });
});

describe('session-start.sh 包含 CURRENT_STATE 注入', () => {
  it('保留原有 Brain 当前状态注入', () => {
    const content = readFileSync(SESSION_START, 'utf8');
    expect(content).toContain('Brain 当前状态');
  });

  it('新增 CURRENT_STATE.md 注入逻辑', () => {
    const content = readFileSync(SESSION_START, 'utf8');
    expect(content).toContain('CURRENT_STATE');
    expect(content).toContain('CURRENT_STATE_FILE');
  });
});
