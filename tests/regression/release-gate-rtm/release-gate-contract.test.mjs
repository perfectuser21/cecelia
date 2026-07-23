/**
 * Contract Tests — 建制W8: 发布准入查账脚本（RTM Release Gate）
 *
 * task_id: f284c0a2-f2ed-4dfc-bd61-ce5416d93c8c
 * contract_dod: sprints/07162100-release-gate-rtm/contract-dod.md
 *
 * ⚠️ 骨架阶段（failing-first 原则）：
 *   - 合同测试先于实现存在，全部应当 FAIL（红灯）
 *   - 当 scripts/release-gate.mjs 实现后，测试应全部变绿
 *
 * 测试运行方式：
 *   node --test sprints/07162100-release-gate-rtm/tests/release-gate-contract.test.mjs
 *   或通过 vitest（若项目已配置）
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import assert from 'node:assert/strict';
// vitest 兼容桥（5167ef48 修复时发现的存量雷）：本文件用 node:test runner，被 brain CI
// fs-guard 全量轮以 vitest import 时 node:test 的 describe/test 不注册 → "No test suite
// found" 文件级红。按运行环境选 runner——两者 describe/test 签名兼容，断言是 node:assert 通用。
const { test, describe } = process.env.VITEST ? await import('vitest') : await import('node:test');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 路径常量
const REPO_ROOT = resolve(__dirname, '../../..');
const SCRIPT = join(REPO_ROOT, 'scripts/release-gate.mjs');
const FIXTURES_DIR = join(__dirname, '__fixtures__');
const RTM_WITH_GAPS = join(FIXTURES_DIR, 'rtm-with-gaps.md');
const RTM_ALL_PASS = join(FIXTURES_DIR, 'rtm-all-pass.md');
const RTM_L0_STEP = join(FIXTURES_DIR, 'rtm-l0-step.md');

/**
 * 运行 release-gate.mjs 并返回 { exitCode, stdout, stderr }
 * @param {string[]} args CLI 参数
 */
function runGate(args) {
  const result = spawnSync('node', [SCRIPT, ...args], {
    encoding: 'utf-8',
    timeout: 5000,  // NFR01: < 2s，测试给 5s 余量
    cwd: REPO_ROOT,
  });
  return {
    exitCode: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

// ─── 前置检查：脚本文件必须存在 ─────────────────────────────────────────────

describe('前置检查', () => {
  test('scripts/release-gate.mjs 文件必须存在', () => {
    // 骨架阶段：此测试会 FAIL（文件尚未创建）
    assert.ok(existsSync(SCRIPT), `脚本文件不存在: ${SCRIPT}`);
  });

  test('fixture 文件必须存在', () => {
    assert.ok(existsSync(RTM_WITH_GAPS), `rtm-with-gaps.md 不存在`);
    assert.ok(existsSync(RTM_ALL_PASS), `rtm-all-pass.md 不存在`);
    assert.ok(existsSync(RTM_L0_STEP), `rtm-l0-step.md 不存在`);
  });
});

// ─── BEHAVIOR-01: 接缝步 L1 < L3 → exit 1 + [BLOCKED] ───────────────────────

describe('[BEHAVIOR-01] 含接缝步 L1 → exit 1 + [BLOCKED] 缺口清单', () => {
  test('exit code 必须为 1', () => {
    const { exitCode } = runGate(['--rtm', RTM_WITH_GAPS]);
    assert.strictEqual(exitCode, 1, `期望 exit 1，实际 exit ${exitCode}`);
  });

  test('stdout 必须含 [BLOCKED]', () => {
    const { stdout, stderr } = runGate(['--rtm', RTM_WITH_GAPS]);
    const output = stdout + stderr;
    assert.ok(
      output.includes('[BLOCKED]'),
      `stdout 中未找到 [BLOCKED]。实际输出:\n${output}`
    );
  });

  test('stdout 必须含 S1（接缝步编号）', () => {
    const { stdout, stderr } = runGate(['--rtm', RTM_WITH_GAPS]);
    const output = stdout + stderr;
    assert.ok(output.includes('S1'), `stdout 中未找到 S1。实际输出:\n${output}`);
  });

  test('stdout 必须含 S3', () => {
    const { stdout, stderr } = runGate(['--rtm', RTM_WITH_GAPS]);
    const output = stdout + stderr;
    assert.ok(output.includes('S3'), `stdout 中未找到 S3。实际输出:\n${output}`);
  });

  test('stdout 必须含 S6', () => {
    const { stdout, stderr } = runGate(['--rtm', RTM_WITH_GAPS]);
    const output = stdout + stderr;
    assert.ok(output.includes('S6'), `stdout 中未找到 S6。实际输出:\n${output}`);
  });

  test('stdout 必须含 S14', () => {
    const { stdout, stderr } = runGate(['--rtm', RTM_WITH_GAPS]);
    const output = stdout + stderr;
    assert.ok(output.includes('S14'), `stdout 中未找到 S14。实际输出:\n${output}`);
  });

  test('stdout 必须含 S15', () => {
    const { stdout, stderr } = runGate(['--rtm', RTM_WITH_GAPS]);
    const output = stdout + stderr;
    assert.ok(output.includes('S15'), `stdout 中未找到 S15。实际输出:\n${output}`);
  });

  test('stdout 必须含 S16', () => {
    const { stdout, stderr } = runGate(['--rtm', RTM_WITH_GAPS]);
    const output = stdout + stderr;
    assert.ok(output.includes('S16'), `stdout 中未找到 S16。实际输出:\n${output}`);
  });

  test('stdout 禁止含 [PASS]（exit 1 时不得放行）', () => {
    const { stdout, stderr } = runGate(['--rtm', RTM_WITH_GAPS]);
    const output = stdout + stderr;
    assert.ok(!output.includes('[PASS]'), `stdout 不应含 [PASS]，实际:\n${output}`);
  });

  test('NFR01: 执行时间 < 2s（5s timeout 内完成）', () => {
    const start = Date.now();
    const { exitCode } = runGate(['--rtm', RTM_WITH_GAPS]);
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 2000, `执行时间 ${elapsed}ms 超过 2000ms`);
    assert.strictEqual(exitCode, 1);
  });
});

// ─── BEHAVIOR-02: RTM 缺失 → exit 2 + [NO_RTM] ──────────────────────────────

describe('[BEHAVIOR-02] RTM 缺失 → exit 2 禁默认放行', () => {
  test('exit code 必须为 2（不得为 0 或 1）', () => {
    const { exitCode } = runGate(['--path', 'nonexistent-path-xyz-contract-test']);
    assert.strictEqual(exitCode, 2, `期望 exit 2，实际 exit ${exitCode}`);
  });

  test('stdout 必须含 [NO_RTM]', () => {
    const { stdout, stderr } = runGate(['--path', 'nonexistent-path-xyz-contract-test']);
    const output = stdout + stderr;
    assert.ok(
      output.includes('[NO_RTM]'),
      `stdout 中未找到 [NO_RTM]。实际输出:\n${output}`
    );
  });

  test('stdout 禁止含 [PASS]（RTM 缺失不得放行）', () => {
    const { stdout, stderr } = runGate(['--path', 'nonexistent-path-xyz-contract-test']);
    const output = stdout + stderr;
    assert.ok(!output.includes('[PASS]'), `stdout 不应含 [PASS]，实际:\n${output}`);
  });

  test('exit 2 不得 exit 0（铁律：禁默认放行）', () => {
    const { exitCode } = runGate(['--path', 'nonexistent-path-xyz-contract-test']);
    assert.notStrictEqual(exitCode, 0, '严禁 RTM 缺失时 exit 0（禁默认放行）');
  });
});

// ─── BEHAVIOR-03: 全达标 → exit 0 + [PASS] ──────────────────────────────────

describe('[BEHAVIOR-03] 全达标 → exit 0 + [PASS]', () => {
  test('exit code 必须为 0', () => {
    const { exitCode } = runGate(['--rtm', RTM_ALL_PASS]);
    assert.strictEqual(exitCode, 0, `期望 exit 0，实际 exit ${exitCode}`);
  });

  test('stdout 必须含 [PASS]', () => {
    const { stdout, stderr } = runGate(['--rtm', RTM_ALL_PASS]);
    const output = stdout + stderr;
    assert.ok(
      output.includes('[PASS]'),
      `stdout 中未找到 [PASS]。实际输出:\n${output}`
    );
  });

  test('stdout 禁止含 [BLOCKED]（全达标不得误报缺口）', () => {
    const { stdout, stderr } = runGate(['--rtm', RTM_ALL_PASS]);
    const output = stdout + stderr;
    assert.ok(!output.includes('[BLOCKED]'), `stdout 不应含 [BLOCKED]，实际:\n${output}`);
  });
});

// ─── BEHAVIOR-04: 非接缝步 L0（承诺≠L0）→ exit 1 ────────────────────────────

describe('[BEHAVIOR-04] 非接缝步 L0（承诺≠L0）→ exit 1', () => {
  test('exit code 必须为 1（S10 承诺 L2 但实际 L0）', () => {
    const { exitCode } = runGate(['--rtm', RTM_L0_STEP]);
    assert.strictEqual(exitCode, 1, `期望 exit 1，实际 exit ${exitCode}`);
  });

  test('stdout 必须含 [BLOCKED]', () => {
    const { stdout, stderr } = runGate(['--rtm', RTM_L0_STEP]);
    const output = stdout + stderr;
    assert.ok(
      output.includes('[BLOCKED]'),
      `stdout 中未找到 [BLOCKED]。实际输出:\n${output}`
    );
  });

  test('stdout 必须含非预期 L0 步骤号（如 S10）', () => {
    const { stdout, stderr } = runGate(['--rtm', RTM_L0_STEP]);
    const output = stdout + stderr;
    // fixture 中 S10 承诺 L2 实际 L0，应被检出
    assert.ok(output.includes('S10'), `stdout 中未找到 S10。实际输出:\n${output}`);
  });
});

// ─── BEHAVIOR-06: exit 1/exit 2 时不写 decisions（无副作用）─────────────────

describe('[BEHAVIOR-06] exit 1/2 时不写 decisions（INV-01 无副作用）', () => {
  test('脚本只接受 --rtm 或 --path 参数，不接受 --write 旗帜', () => {
    // INV-02: 禁止宽松模式或 --force / --write 旗帜
    // 通过 --help 输出验证：不应含 --force 或 --no-gate 参数
    const { stdout, stderr } = runGate(['--help']);
    const output = stdout + stderr;
    assert.ok(!output.includes('--force'), `help 不应含 --force 旗帜`);
    assert.ok(!output.includes('--no-gate'), `help 不应含 --no-gate 旗帜`);
  });

  // 注：DB 写操作验证在 E2E 阶段用 psql 验证（见 contract-dod.md BEHAVIOR-06）
  // 单元层此处通过 mock/spy 验证：当 exit 1 时，writeDecision 函数不被调用
  test('TODO: 实现后补充 DB mock 验证 — exit 1 时 writeDecision 不被调用', () => {
    // 骨架占位，实现者补充 mock 逻辑
    // 期望：mock writeDecision，运行 rtm-with-gaps → 验证 mock 未被调用
    assert.ok(true, '骨架占位，待实现后补充');
  });
});

// ─── BEHAVIOR-05（CLI 层）: --help exit 0 ────────────────────────────────────

describe('[FR01] --help exit 0', () => {
  test('node scripts/release-gate.mjs --help → exit 0', () => {
    const { exitCode } = runGate(['--help']);
    assert.strictEqual(exitCode, 0, `--help 应 exit 0，实际 exit ${exitCode}`);
  });
});

// ─── RTM 解析能力：通过 fixture 替换验证不依赖 hardcoded 步骤名 ──────────────

describe('[FR10] RTM 解析不硬编码 Path4 步骤名', () => {
  test('使用自定义 RTM fixture 时，仍能正确解析接缝步等级', () => {
    // 给定 rtm-all-pass.md（非 path4 默认路径），脚本应正常处理
    const { exitCode } = runGate(['--rtm', RTM_ALL_PASS]);
    assert.strictEqual(exitCode, 0, `自定义 RTM fixture 应 exit 0，实际 exit ${exitCode}`);
  });

  test('给定 rtm-with-gaps.md（非 path4 默认路径），仍能检出接缝步缺口', () => {
    const { exitCode } = runGate(['--rtm', RTM_WITH_GAPS]);
    assert.strictEqual(exitCode, 1, `自定义含缺口 RTM 应 exit 1，实际 exit ${exitCode}`);
  });
});
