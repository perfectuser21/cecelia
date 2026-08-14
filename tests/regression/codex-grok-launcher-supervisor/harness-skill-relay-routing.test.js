/**
 * harness-skill-relay-routing.test.js
 * Contract test — Sprint: Codex/Grok 有头 Launcher + 无头 Provider-Neutral Supervisor
 *
 * 验证 _spawnHeadedSession 的 innerCmd 三分支路由正确性（INV-1）
 * RED：以现有代码证明 bug（executor=grok 落入 codex 二元分支）
 * GREEN：修复后断言三分支正确
 */

'use strict';

const fs = require('fs');
const path = require('path');

const RELAY_PATH = path.resolve(__dirname, '../../../packages/brain/src/harness-skill-relay.js');

function readRelay() {
  return fs.readFileSync(RELAY_PATH, 'utf8');
}

function readSpawnHeadedSession() {
  const src = readRelay();
  const functionDeclaration = 'async function _spawnHeadedSession';
  const fnStart = src.indexOf(functionDeclaration);
  expect(fnStart).toBeGreaterThanOrEqual(0);
  return src.slice(fnStart);
}

describe('harness-skill-relay-routing: INV-1 三分支路由', () => {
  // ─── 测试 1: executor=grok 时 innerCmd 含 grok-launch.sh（INV-1 GREEN） ─────
  test('executor=grok 时 innerCmd 含 grok-launch.sh（三分支 GREEN）', () => {
    const section = readSpawnHeadedSession();
    expect(/grok-launch\.sh/.test(section)).toBe(true);
  });

  // ─── 测试 2: executor=claude 时 innerCmd 含 claude-launch.sh（GP1 不回归） ──
  test('executor=claude 时 innerCmd 仍含 claude-launch.sh（GP1 零回归）', () => {
    const section = readSpawnHeadedSession();
    expect(/claude-launch\.sh/.test(section)).toBe(true);
  });

  // ─── 测试 3: 禁止二元形式 isClaudeHeaded ? ... : codex（INV-1 反向断言） ────
  test('innerCmd 无二元 isClaudeHeaded ? ... : codex 形态（INV-1 GREEN）', () => {
    const section = readSpawnHeadedSession();
    // 检测 innerCmd 赋值时的二元形式：isClaudeHeaded ? ... : `...codex ...`
    const binaryPattern = /const innerCmd\s*=\s*isClaudeHeaded[\s\S]{0,200}:\s*`[^`]*codex[^`]*`/;
    expect(binaryPattern.test(section)).toBe(false);
  });

  // ─── 测试 4: executor=unknown 时 loud-fail（INV-8） ─────────────────────────
  test('executor=unknown 时存在 loud-fail 提示（INV-8）', () => {
    const src = readRelay();
    const hasLoudFail = /unsupported executor|unknown executor/.test(src);
    expect(hasLoudFail).toBe(true);
  });

  // ─── 测试 5: grok-launch.sh 文件存在（FR-R4 产物） ──────────────────────────
  test('scripts/grok-launch.sh 文件存在（FR-R4）', () => {
    const target = path.resolve(__dirname, '../../../scripts/grok-launch.sh');
    expect(fs.existsSync(target)).toBe(true);
  });

  // ─── 测试 6: codex-launch.sh 文件存在（FR-R3 产物） ─────────────────────────
  test('scripts/codex-launch.sh 文件存在（FR-R3）', () => {
    const target = path.resolve(__dirname, '../../../scripts/codex-launch.sh');
    expect(fs.existsSync(target)).toBe(true);
  });

  // ─── 测试 7: codex-supervisor.mjs 存在（FR-R5 产物） ────────────────────────
  test('scripts/codex-supervisor.mjs 文件存在（FR-R5）', () => {
    const target = path.resolve(__dirname, '../../../scripts/codex-supervisor.mjs');
    expect(fs.existsSync(target)).toBe(true);
  });

  // ─── 测试 8: grok-supervisor.mjs 存在（FR-R6 产物） ─────────────────────────
  test('scripts/grok-supervisor.mjs 文件存在（FR-R6）', () => {
    const target = path.resolve(__dirname, '../../../scripts/grok-supervisor.mjs');
    expect(fs.existsSync(target)).toBe(true);
  });

  // ─── 测试 9: isGrokHeaded 三分支变量在 _spawnHeadedSession 中存在 ────────────
  test('_spawnHeadedSession 中 isGrokHeaded 变量被使用（三分支逻辑存在）', () => {
    const section = readSpawnHeadedSession();
    expect(/isGrokHeaded/.test(section)).toBe(true);
  });
});
