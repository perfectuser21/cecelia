/**
 * harness-skill-relay-routing.test.js
 * Contract test — Sprint: Codex/Grok 有头 Launcher + 无头 Provider-Neutral Supervisor
 *
 * 验证 _spawnHeadedSession 的 innerCmd 三分支路由正确性（INV-1）
 * RED：以现有代码证明 bug（executor=grok 落入 codex 二元分支）
 * GREEN：修复后断言三分支正确
 *
 * 运行方式：node packages/brain/__tests__/harness-skill-relay-routing.test.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

const RELAY_PATH = path.join(__dirname, '../../../packages/brain/src/harness-skill-relay.js');

let PASS = 0;
let FAIL = 0;

function pass(name) {
  console.log(`  PASS: ${name}`);
  PASS++;
}

function fail(name, reason) {
  console.error(`  FAIL: ${name} — ${reason}`);
  FAIL++;
}

function readRelay() {
  return fs.readFileSync(RELAY_PATH, 'utf8');
}

// ─── 测试 1: executor=grok 时 innerCmd 含 grok-launch.sh（INV-1 GREEN） ─────
function test_grok_innerCmd_contains_grok_launch() {
  const src = readRelay();
  // 提取 _spawnHeadedSession 函数体
  const fnStart = src.indexOf('_spawnHeadedSession');
  const section = fnStart >= 0 ? src.slice(fnStart, fnStart + 5000) : src;

  if (/grok-launch\.sh/.test(section)) {
    pass('executor=grok 时 innerCmd 含 grok-launch.sh（三分支 GREEN）');
  } else {
    fail('executor=grok 时 innerCmd 含 grok-launch.sh（三分支 GREEN）',
      'grok-launch.sh 不在 _spawnHeadedSession 中 — bug 未修复');
  }
}

// ─── 测试 2: executor=claude 时 innerCmd 含 claude-launch.sh（GP1 不回归） ──
function test_claude_innerCmd_not_regressed() {
  const src = readRelay();
  const fnStart = src.indexOf('_spawnHeadedSession');
  const section = fnStart >= 0 ? src.slice(fnStart, fnStart + 5000) : src;

  if (/claude-launch\.sh/.test(section)) {
    pass('executor=claude 时 innerCmd 仍含 claude-launch.sh（GP1 零回归）');
  } else {
    fail('executor=claude 时 innerCmd 仍含 claude-launch.sh（GP1 零回归）',
      'claude-launch.sh 消失 — claude 路径被破坏');
  }
}

// ─── 测试 3: 禁止二元形式 isClaudeHeaded ? ... : codex（INV-1 反向断言） ────
function test_no_binary_routing_bug() {
  const src = readRelay();
  const fnStart = src.indexOf('_spawnHeadedSession');
  const section = fnStart >= 0 ? src.slice(fnStart, fnStart + 5000) : src;

  // 检测 innerCmd 赋值时的二元形式：isClaudeHeaded ? ... : `...codex ...`
  const binaryPattern = /const innerCmd\s*=\s*isClaudeHeaded[\s\S]{0,200}:\s*`[^`]*codex[^`]*`/;
  if (binaryPattern.test(section)) {
    fail('innerCmd 无二元 isClaudeHeaded ? ... : codex 形态（INV-1）',
      '二元路由 bug 仍然存在（Grok headed 会落入 codex 命令）');
  } else {
    pass('innerCmd 无二元 isClaudeHeaded ? ... : codex 形态（INV-1 GREEN）');
  }
}

// ─── 测试 4: executor=unknown 时 loud-fail（INV-8） ─────────────────────────
function test_unknown_executor_loud_fail() {
  const src = readRelay();
  const hasLoudFail = /unsupported executor|unknown executor/.test(src);
  if (hasLoudFail) {
    pass('executor=unknown 时存在 loud-fail 提示（INV-8）');
  } else {
    fail('executor=unknown 时存在 loud-fail 提示（INV-8）',
      '找不到 "unsupported executor" 或 "unknown executor" 字符串');
  }
}

// ─── 测试 5: grok-launch.sh 文件存在（FR-R4 产物） ──────────────────────────
function test_grok_launch_sh_exists() {
  const target = path.join(__dirname, '../../../scripts/grok-launch.sh');
  if (fs.existsSync(target)) {
    pass('scripts/grok-launch.sh 文件存在（FR-R4）');
  } else {
    fail('scripts/grok-launch.sh 文件存在（FR-R4）', '文件不存在');
  }
}

// ─── 测试 6: codex-launch.sh 文件存在（FR-R3 产物） ─────────────────────────
function test_codex_launch_sh_exists() {
  const target = path.join(__dirname, '../../../scripts/codex-launch.sh');
  if (fs.existsSync(target)) {
    pass('scripts/codex-launch.sh 文件存在（FR-R3）');
  } else {
    fail('scripts/codex-launch.sh 文件存在（FR-R3）', '文件不存在');
  }
}

// ─── 测试 7: codex-supervisor.mjs 存在（FR-R5 产物） ────────────────────────
function test_codex_supervisor_exists() {
  const target = path.join(__dirname, '../../../scripts/codex-supervisor.mjs');
  if (fs.existsSync(target)) {
    pass('scripts/codex-supervisor.mjs 文件存在（FR-R5）');
  } else {
    fail('scripts/codex-supervisor.mjs 文件存在（FR-R5）', '文件不存在');
  }
}

// ─── 测试 8: grok-supervisor.mjs 存在（FR-R6 产物） ─────────────────────────
function test_grok_supervisor_exists() {
  const target = path.join(__dirname, '../../../scripts/grok-supervisor.mjs');
  if (fs.existsSync(target)) {
    pass('scripts/grok-supervisor.mjs 文件存在（FR-R6）');
  } else {
    fail('scripts/grok-supervisor.mjs 文件存在（FR-R6）', '文件不存在');
  }
}

// ─── 测试 9: isGrokHeaded 三分支变量在 _spawnHeadedSession 中存在 ────────────
function test_isGrokHeaded_used_in_innerCmd() {
  const src = readRelay();
  const fnStart = src.indexOf('_spawnHeadedSession');
  const section = fnStart >= 0 ? src.slice(fnStart, fnStart + 5000) : src;

  if (/isGrokHeaded/.test(section)) {
    pass('_spawnHeadedSession 中 isGrokHeaded 变量被使用（三分支逻辑存在）');
  } else {
    fail('_spawnHeadedSession 中 isGrokHeaded 变量被使用（三分支逻辑存在）',
      'isGrokHeaded 在 _spawnHeadedSession 中未使用 — 三分支可能未实现');
  }
}

// ─── 运行所有测试 ─────────────────────────────────────────────────────────────
console.log('\n[harness-skill-relay-routing] Contract Test: INV-1 三分支路由\n');

test_grok_innerCmd_contains_grok_launch();
test_claude_innerCmd_not_regressed();
test_no_binary_routing_bug();
test_unknown_executor_loud_fail();
test_grok_launch_sh_exists();
test_codex_launch_sh_exists();
test_codex_supervisor_exists();
test_grok_supervisor_exists();
test_isGrokHeaded_used_in_innerCmd();

console.log(`\n结果: ${PASS} PASS, ${FAIL} FAIL\n`);
if (FAIL > 0) {
  process.exit(1);
}
