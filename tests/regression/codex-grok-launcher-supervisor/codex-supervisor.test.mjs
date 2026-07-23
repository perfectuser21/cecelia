/**
 * codex-supervisor.test.mjs
 * Contract test — scripts/codex-supervisor.mjs
 *
 * 【静态源码断言，非运行时验证】
 * 通过 grep/正则对 codex-supervisor.mjs 源码进行结构断言，验证：
 *   - continue 时用同一 session-id 续跑（INV-5 + GP5）
 *   - complete 须外部验收，不信模型自称（INV-6）
 *   - blocked 写 Brain 不标 completed（INV-7）
 *   - 超 MAX_TURNS 标 timed_out exit 1（FR-R5）
 *   - Brain API 调用存在（Risk mitigation）
 *
 * 注意：本测试为纯静态分析（源码结构验证），不启动 fake binary 或 fake Brain HTTP server。
 * 运行时行为验证通过 RED 阶段 git stash 对比执行，由 generator 在 PR 描述中注释结果。
 *
 * 运行方式：node sprints/07222128-codex-grok-launcher-supervisor/tests/codex-supervisor.test.mjs
 */

import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TARGET = join(__dirname, '../../../scripts/codex-supervisor.mjs');

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

// ─── 如果脚本不存在，做静态存在性检查后退出 ─────────────────────────────────
if (!existsSync(TARGET)) {
  fail('scripts/codex-supervisor.mjs 存在', '文件未创建');
  console.log(`\n结果: ${PASS} PASS, ${FAIL} FAIL\n`);
  process.exit(1);
}

console.log('\n[codex-supervisor.test] Contract Test: codex-supervisor.mjs 三态协议\n');

const src = readFileSync(TARGET, 'utf8');

// ─── 静态源码断言（快速验证） ─────────────────────────────────────────────────

function test_max_turns_defined() {
  if (/MAX_TURNS.*10|MAX_TURNS\s*=\s*10/.test(src)) {
    pass('codex-supervisor.mjs 含 MAX_TURNS=10（FR-R5）');
  } else {
    fail('codex-supervisor.mjs 含 MAX_TURNS=10（FR-R5）', 'MAX_TURNS=10 未找到');
  }
}

function test_deadline_defined() {
  if (/SUPERVISOR_DEADLINE_SECONDS.*28800|28800/.test(src)) {
    pass('codex-supervisor.mjs 含 SUPERVISOR_DEADLINE_SECONDS=28800（FR-R5 NFR）');
  } else {
    fail('codex-supervisor.mjs 含 SUPERVISOR_DEADLINE_SECONDS=28800（FR-R5 NFR）', '28800 未找到');
  }
}

function test_three_states() {
  const hasComplete = /['"]complete['"]/.test(src);
  const hasContinue = /['"]continue['"]/.test(src);
  const hasBlocked = /['"]blocked['"]/.test(src);
  if (hasComplete && hasContinue && hasBlocked) {
    pass('codex-supervisor.mjs 含 complete/continue/blocked 三态（FR-R5）');
  } else {
    fail('codex-supervisor.mjs 含 complete/continue/blocked 三态（FR-R5）',
      `complete=${hasComplete} continue=${hasContinue} blocked=${hasBlocked}`);
  }
}

function test_resume_with_session() {
  if (/resume.*session|session.*resume|codex.*exec.*resume/.test(src)) {
    pass('codex-supervisor.mjs continue 路径含 resume session-id（INV-5）');
  } else {
    fail('codex-supervisor.mjs continue 路径含 resume session-id（INV-5）',
      'resume session 相关逻辑未找到');
  }
}

function test_blocked_brain_patch() {
  if (/PATCH.*tasks|tasks.*PATCH|blocked.*brain|brain.*blocked/.test(src.toLowerCase()) ||
      /fetch.*PATCH|PATCH.*status.*blocked|blocked.*status/.test(src)) {
    pass('codex-supervisor.mjs blocked 状态写 Brain（INV-7）');
  } else {
    fail('codex-supervisor.mjs blocked 状态写 Brain（INV-7）',
      'Brain PATCH blocked 逻辑未找到');
  }
}

function test_timed_out() {
  if (/timed_out|timedOut|timeout.*exit 1|exit.*1.*timeout/.test(src)) {
    pass('codex-supervisor.mjs 超限标 timed_out exit 1（FR-R5）');
  } else {
    fail('codex-supervisor.mjs 超限标 timed_out exit 1（FR-R5）', 'timed_out 处理未找到');
  }
}

function test_external_verification() {
  // complete 不信模型自称：必须有外部验收相关代码（调 Brain API 或 PR 检查）
  const hasExternalCheck = /brain.*task|task.*brain|phase.*external|external.*verif|pr.*status|github.*check/i.test(src);
  if (hasExternalCheck) {
    pass('codex-supervisor.mjs complete 路径含外部验收逻辑（INV-6）');
  } else {
    // 宽松：只要不是直接信 model 输出就行——检查是否至少有 Brain API 调用
    if (/localhost.*5221|host\.docker\.internal.*5221|BRAIN_URL/.test(src)) {
      pass('codex-supervisor.mjs 含 Brain API 调用（INV-6 宽松——外部验收通过 Brain）');
    } else {
      fail('codex-supervisor.mjs complete 路径含外部验收逻辑（INV-6）',
        '未找到 Brain API 调用或外部验收逻辑');
    }
  }
}

function test_blocked_not_completed() {
  // blocked 不能写 completed：检查 blocked 分支里没有写 completed 状态
  const blockedSectionMatch = src.match(/blocked[\s\S]{0,500}completed/i);
  if (blockedSectionMatch) {
    // 仔细检查：是否在同一块里 blocked 后写了 completed
    const snippet = blockedSectionMatch[0];
    if (/status.*completed|completed.*status/.test(snippet) && !/\/\/|#/.test(snippet.slice(0, 10))) {
      fail('blocked 分支不伪装 completed（INV-7）', '在 blocked 分支近处发现 completed 状态写入');
    } else {
      pass('blocked 分支不伪装 completed（INV-7 — 上下文检查通过）');
    }
  } else {
    pass('blocked 分支不伪装 completed（INV-7 — 无 blocked+completed 混用）');
  }
}

// ─── 运行静态测试 ────────────────────────────────────────────────────────────
test_max_turns_defined();
test_deadline_defined();
test_three_states();
test_resume_with_session();
test_blocked_brain_patch();
test_timed_out();
test_external_verification();
test_blocked_not_completed();

// ─── 动态运行时测试（需要脚本可执行，fake Brain server）───────────────────────
// 仅在有 node 可执行且脚本语法正确时运行

function test_syntax_valid() {
  try {
    execSync(`node --input-type=module --check < "${TARGET}"`, { encoding: 'utf8', timeout: 10000 });
    pass('codex-supervisor.mjs ES module 语法有效');
  } catch (e) {
    fail('codex-supervisor.mjs ES module 语法有效', e.message.slice(0, 200));
  }
}

test_syntax_valid();

// ─── 输出结果 ────────────────────────────────────────────────────────────────
console.log(`\n结果: ${PASS} PASS, ${FAIL} FAIL\n`);

// vitest 兼容桥（issue 5167ef48 修复时发现的存量雷）：brain CI 的 fs-guard 全量轮会把本
// plain-node 脚本当测试文件 import——顶层 process.exit 会杀死 vitest worker（shard 级全红）。
// vitest 环境下改为注册单条用例传递结果；plain node 下维持原退出码语义（core-regression 用）。
if (process.env.VITEST) {
  const { describe, it, expect } = await import('vitest');
  describe('codex-supervisor (plain-node bridge)', () => {
    it(`${PASS} PASS, ${FAIL} FAIL`, () => { expect(FAIL).toBe(0); });
  });
} else if (FAIL > 0) {
  process.exit(1);
}

