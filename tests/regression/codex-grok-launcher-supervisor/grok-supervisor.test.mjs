/**
 * grok-supervisor.test.mjs
 * Contract test — scripts/grok-supervisor.mjs
 *
 * 【静态源码断言，非运行时验证】
 * 通过 grep/正则对 grok-supervisor.mjs 源码进行结构断言，验证：
 *   - continue 时用 grok -p ... --resume session-id（INV-5 + GP6）
 *   - blocked 写 Brain 不标 completed（INV-7）
 *   - 超 MAX_TURNS 标 timed_out exit 1（FR-R6）
 *   - complete 须外部验收（INV-6）
 *
 * 注意：本测试为纯静态分析（源码结构验证），不启动 fake binary 或 fake Brain HTTP server。
 * 运行时行为验证通过 RED 阶段 git stash 对比执行，由 generator 在 PR 描述中注释结果。
 *
 * 运行方式：node sprints/07222128-codex-grok-launcher-supervisor/tests/grok-supervisor.test.mjs
 */

import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TARGET = join(__dirname, '../../../scripts/grok-supervisor.mjs');

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

if (!existsSync(TARGET)) {
  fail('scripts/grok-supervisor.mjs 存在', '文件未创建');
  console.log(`\n结果: ${PASS} PASS, ${FAIL} FAIL\n`);
  process.exit(1);
}

console.log('\n[grok-supervisor.test] Contract Test: grok-supervisor.mjs 三态协议\n');

const src = readFileSync(TARGET, 'utf8');

// ─── 静态源码断言 ─────────────────────────────────────────────────────────────

function test_max_turns_defined() {
  if (/MAX_TURNS.*10|MAX_TURNS\s*=\s*10/.test(src)) {
    pass('grok-supervisor.mjs 含 MAX_TURNS=10（FR-R6）');
  } else {
    fail('grok-supervisor.mjs 含 MAX_TURNS=10（FR-R6）', 'MAX_TURNS=10 未找到');
  }
}

function test_deadline_defined() {
  if (/SUPERVISOR_DEADLINE_SECONDS.*28800|28800/.test(src)) {
    pass('grok-supervisor.mjs 含 SUPERVISOR_DEADLINE_SECONDS=28800（NFR）');
  } else {
    fail('grok-supervisor.mjs 含 SUPERVISOR_DEADLINE_SECONDS=28800（NFR）', '28800 未找到');
  }
}

function test_three_states() {
  const hasComplete = /['"]complete['"]/.test(src);
  const hasContinue = /['"]continue['"]/.test(src);
  const hasBlocked = /['"]blocked['"]/.test(src);
  if (hasComplete && hasContinue && hasBlocked) {
    pass('grok-supervisor.mjs 含 complete/continue/blocked 三态（FR-R6）');
  } else {
    fail('grok-supervisor.mjs 含 complete/continue/blocked 三态（FR-R6）',
      `complete=${hasComplete} continue=${hasContinue} blocked=${hasBlocked}`);
  }
}

function test_grok_resume_session() {
  // continue 路径：grok -p ... --resume <session-id>
  if (/grok.*-p.*--resume|--resume.*session|resume.*session/i.test(src)) {
    pass('grok-supervisor.mjs continue 路径含 grok -p --resume session-id（INV-5 + GP6）');
  } else {
    fail('grok-supervisor.mjs continue 路径含 grok -p --resume session-id（INV-5 + GP6）',
      'grok -p --resume session-id 相关逻辑未找到');
  }
}

function test_blocked_brain_patch() {
  if (/PATCH.*tasks|tasks.*PATCH|blocked.*brain|brain.*blocked|fetch.*PATCH/i.test(src)) {
    pass('grok-supervisor.mjs blocked 状态写 Brain（INV-7）');
  } else {
    fail('grok-supervisor.mjs blocked 状态写 Brain（INV-7）', 'Brain PATCH blocked 逻辑未找到');
  }
}

function test_timed_out() {
  if (/timed_out|timedOut|timeout.*exit 1|exit.*1.*timeout/i.test(src)) {
    pass('grok-supervisor.mjs 超限标 timed_out exit 1（FR-R6）');
  } else {
    fail('grok-supervisor.mjs 超限标 timed_out exit 1（FR-R6）', 'timed_out 处理未找到');
  }
}

function test_external_verification() {
  const hasExternalCheck = /brain.*task|task.*brain|phase.*external|external.*verif|pr.*status|BRAIN_URL/i.test(src);
  if (hasExternalCheck) {
    pass('grok-supervisor.mjs complete 路径含外部验收逻辑（INV-6）');
  } else {
    if (/localhost.*5221|host\.docker\.internal.*5221/.test(src)) {
      pass('grok-supervisor.mjs 含 Brain API 调用（INV-6 宽松）');
    } else {
      fail('grok-supervisor.mjs complete 路径含外部验收逻辑（INV-6）', '未找到外部验收逻辑');
    }
  }
}

function test_blocked_not_completed() {
  const blockedSectionMatch = src.match(/blocked[\s\S]{0,500}completed/i);
  if (blockedSectionMatch) {
    const snippet = blockedSectionMatch[0];
    if (/status.*completed|completed.*status/.test(snippet)) {
      fail('blocked 分支不伪装 completed（INV-7）', '在 blocked 分支近处发现 completed 状态写入');
    } else {
      pass('blocked 分支不伪装 completed（INV-7 — 上下文检查通过）');
    }
  } else {
    pass('blocked 分支不伪装 completed（INV-7 — 无 blocked+completed 混用）');
  }
}

function test_grok_output_format_json() {
  // grok -p ... --output-format json（首轮命令格式）
  if (/output-format.*json|output_format.*json/i.test(src)) {
    pass('grok-supervisor.mjs 首轮含 --output-format json（FR-R6 GP6）');
  } else {
    fail('grok-supervisor.mjs 首轮含 --output-format json（FR-R6 GP6）',
      '--output-format json 未找到');
  }
}

function test_syntax_valid() {
  try {
    execSync(`node --input-type=module --check < "${TARGET}"`, { encoding: 'utf8', timeout: 10000 });
    pass('grok-supervisor.mjs ES module 语法有效');
  } catch (e) {
    fail('grok-supervisor.mjs ES module 语法有效', e.message.slice(0, 200));
  }
}

// ─── 运行所有测试 ────────────────────────────────────────────────────────────
test_max_turns_defined();
test_deadline_defined();
test_three_states();
test_grok_resume_session();
test_grok_output_format_json();
test_blocked_brain_patch();
test_timed_out();
test_external_verification();
test_blocked_not_completed();
test_syntax_valid();

console.log(`\n结果: ${PASS} PASS, ${FAIL} FAIL\n`);

// vitest 兼容桥（issue 5167ef48 修复时发现的存量雷）：brain CI 的 fs-guard 全量轮会把本
// plain-node 脚本当测试文件 import——顶层 process.exit 会杀死 vitest worker（shard 级全红）。
// vitest 环境下改为注册单条用例传递结果；plain node 下维持原退出码语义（core-regression 用）。
if (process.env.VITEST) {
  const { describe, it, expect } = await import('vitest');
  describe('grok-supervisor (plain-node bridge)', () => {
    it(`${PASS} PASS, ${FAIL} FAIL`, () => { expect(FAIL).toBe(0); });
  });
} else if (FAIL > 0) {
  process.exit(1);
}

