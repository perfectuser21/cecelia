/**
 * WS1 Red Test — goals.js /health codex_bridge_status 字段
 *
 * 在 WS1 实现前这些测试全部 FAIL：
 *   - goals.js 未添加 codex_bridge_status 字段
 *   - goals.js 未添加 XIAN_CODEX_BRIDGE_URL 探活逻辑
 *   - goals.js 未添加 offline fallback
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const GOALS_PATH = resolve('./packages/brain/src/routes/goals.js');

describe('[WS1 Red] goals.js /health codex_bridge_status 字段', () => {
  it('goals.js /health handler 包含 codex_bridge_status 字段写入', () => {
    const content = readFileSync(GOALS_PATH, 'utf8');
    // FAIL before WS1 — goals.js 未添加 codex_bridge_status
    expect(content).toContain('codex_bridge_status');
  });

  it('goals.js /health handler 包含 bridge 探活 URL（XIAN_CODEX_BRIDGE_URL 或默认值）', () => {
    const content = readFileSync(GOALS_PATH, 'utf8');
    // FAIL before WS1 — goals.js 未添加探活 URL
    expect(content).toMatch(/XIAN_CODEX_BRIDGE_URL|100\.86\.57\.69/);
  });

  it('goals.js /health handler 包含 offline fallback（catch 分支写 "offline"）', () => {
    const content = readFileSync(GOALS_PATH, 'utf8');
    // FAIL before WS1 — goals.js 未添加 offline fallback
    expect(content).toContain("'offline'");
  });
});
