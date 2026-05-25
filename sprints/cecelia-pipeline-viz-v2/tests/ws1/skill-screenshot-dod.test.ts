import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SKILL_PATH = resolve(process.cwd(), 'packages/workflows/skills/harness-contract-proposer/SKILL.md');

describe('WS1 — SKILL.md mac_web 截图 DoD 注入 [BEHAVIOR]', () => {
  it('SKILL.md 含 [BEHAVIOR:E2E:screenshot] 截图条目文字', () => {
    const content = readFileSync(SKILL_PATH, 'utf8');
    expect(content).toContain('[BEHAVIOR:E2E:screenshot]');
  });

  it('截图条目包含 screenshots/<ws_id>-<step>.png 格式', () => {
    const content = readFileSync(SKILL_PATH, 'utf8');
    expect(content).toMatch(/screenshots\/.*-.*\.png/);
  });

  it('截图条目包含 ~/claude-output/harness-screenshots/ 目标路径', () => {
    const content = readFileSync(SKILL_PATH, 'utf8');
    expect(content).toContain('~/claude-output/harness-screenshots/');
  });

  it('截图条目在 mac_web 合约模板区块内（target_environment = mac_web 区块之后）', () => {
    const content = readFileSync(SKILL_PATH, 'utf8');
    const macWebIdx = content.indexOf('target_environment = mac_web');
    const screenshotIdx = content.indexOf('[BEHAVIOR:E2E:screenshot]');
    expect(macWebIdx).toBeGreaterThan(-1);
    expect(screenshotIdx).toBeGreaterThan(macWebIdx);
  });
});
