/**
 * Contract Tests — 建制W8: 发布准入查账脚本（RTM Release Gate）
 *
 * task_id: f284c0a2-f2ed-4dfc-bd61-ce5416d93c8c
 * contract_dod: sprints/07162100-release-gate-rtm/contract-dod.md
 *
 * 测试只写本人随机端口HTTP夹具，fetch/TCP/DNS哨兵拒绝其它网络。
 *
 * 测试运行方式：
 *   node --test scripts/__tests__/release-gate.test.mjs
 *   或通过 vitest（若项目已配置）
 */

import { createReleaseGateFixture } from '../../tests/helpers/release-gate-fixture.mjs';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { test, describe, before, after } from 'node:test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 路径常量（本文件位于 scripts/__tests__/，故 ../.. 即 repo 根）
const REPO_ROOT = resolve(__dirname, '../..');
const SCRIPT = join(REPO_ROOT, 'scripts/release-gate.mjs');
const FIXTURES_DIR = join(__dirname, '__fixtures__');
const RTM_WITH_GAPS = join(FIXTURES_DIR, 'rtm-with-gaps.md');
const RTM_ALL_PASS = join(FIXTURES_DIR, 'rtm-all-pass.md');
const RTM_L0_STEP = join(FIXTURES_DIR, 'rtm-l0-step.md');

/**
 * 运行 release-gate.mjs 并返回 { exitCode, stdout, stderr }
 * @param {string[]} args CLI 参数
 */
let fixture;
before(async () => { fixture = await createReleaseGateFixture(REPO_ROOT); });
after(async () => { if (fixture) await fixture.close(); });
const runGate = args => fixture.runGate(args);

// ─── 前置检查：脚本文件必须存在 ─────────────────────────────────────────────

describe('前置检查', async () => {
  test('scripts/release-gate.mjs 文件必须存在', async () => {
    assert.ok(existsSync(SCRIPT), `脚本文件不存在: ${SCRIPT}`);
  });

  test('fixture 文件必须存在', async () => {
    assert.ok(existsSync(RTM_WITH_GAPS), `rtm-with-gaps.md 不存在`);
    assert.ok(existsSync(RTM_ALL_PASS), `rtm-all-pass.md 不存在`);
    assert.ok(existsSync(RTM_L0_STEP), `rtm-l0-step.md 不存在`);
  });
});

// ─── BEHAVIOR-01: 接缝步 L1 < L3 → exit 1 + [BLOCKED] ───────────────────────

describe('[BEHAVIOR-01] 含接缝步 L1 → exit 1 + [BLOCKED] 缺口清单', async () => {
  test('exit code 必须为 1', async () => {
    const { exitCode } = await runGate(['--rtm', RTM_WITH_GAPS]);
    assert.strictEqual(exitCode, 1, `期望 exit 1，实际 exit ${exitCode}`);
  });

  test('stdout 必须含 [BLOCKED]', async () => {
    const { stdout, stderr } = await runGate(['--rtm', RTM_WITH_GAPS]);
    const output = stdout + stderr;
    assert.ok(
      output.includes('[BLOCKED]'),
      `stdout 中未找到 [BLOCKED]。实际输出:\n${output}`
    );
  });

  test('stdout 必须含 S1（接缝步编号）', async () => {
    const { stdout, stderr } = await runGate(['--rtm', RTM_WITH_GAPS]);
    const output = stdout + stderr;
    assert.ok(output.includes('S1'), `stdout 中未找到 S1。实际输出:\n${output}`);
  });

  test('stdout 必须含 S3', async () => {
    const { stdout, stderr } = await runGate(['--rtm', RTM_WITH_GAPS]);
    const output = stdout + stderr;
    assert.ok(output.includes('S3'), `stdout 中未找到 S3。实际输出:\n${output}`);
  });

  test('stdout 必须含 S6', async () => {
    const { stdout, stderr } = await runGate(['--rtm', RTM_WITH_GAPS]);
    const output = stdout + stderr;
    assert.ok(output.includes('S6'), `stdout 中未找到 S6。实际输出:\n${output}`);
  });

  test('stdout 必须含 S14', async () => {
    const { stdout, stderr } = await runGate(['--rtm', RTM_WITH_GAPS]);
    const output = stdout + stderr;
    assert.ok(output.includes('S14'), `stdout 中未找到 S14。实际输出:\n${output}`);
  });

  test('stdout 必须含 S15', async () => {
    const { stdout, stderr } = await runGate(['--rtm', RTM_WITH_GAPS]);
    const output = stdout + stderr;
    assert.ok(output.includes('S15'), `stdout 中未找到 S15。实际输出:\n${output}`);
  });

  test('stdout 必须含 S16', async () => {
    const { stdout, stderr } = await runGate(['--rtm', RTM_WITH_GAPS]);
    const output = stdout + stderr;
    assert.ok(output.includes('S16'), `stdout 中未找到 S16。实际输出:\n${output}`);
  });

  test('stdout 禁止含 [PASS]（exit 1 时不得放行）', async () => {
    const { stdout, stderr } = await runGate(['--rtm', RTM_WITH_GAPS]);
    const output = stdout + stderr;
    assert.ok(!output.includes('[PASS]'), `stdout 不应含 [PASS]，实际:\n${output}`);
  });

  test('NFR01: 执行时间 < 2s（5s timeout 内完成）', async () => {
    const start = Date.now();
    const { exitCode } = await runGate(['--rtm', RTM_WITH_GAPS]);
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 2000, `执行时间 ${elapsed}ms 超过 2000ms`);
    assert.strictEqual(exitCode, 1);
  });
});

// ─── BEHAVIOR-02: RTM 缺失 → exit 2 + [NO_RTM] ──────────────────────────────

describe('[BEHAVIOR-02] RTM 缺失 → exit 2 禁默认放行', async () => {
  test('exit code 必须为 2（不得为 0 或 1）', async () => {
    const { exitCode } = await runGate(['--path', 'nonexistent-path-xyz-contract-test']);
    assert.strictEqual(exitCode, 2, `期望 exit 2，实际 exit ${exitCode}`);
  });

  test('stdout 必须含 [NO_RTM]', async () => {
    const { stdout, stderr } = await runGate(['--path', 'nonexistent-path-xyz-contract-test']);
    const output = stdout + stderr;
    assert.ok(
      output.includes('[NO_RTM]'),
      `stdout 中未找到 [NO_RTM]。实际输出:\n${output}`
    );
  });

  test('stdout 禁止含 [PASS]（RTM 缺失不得放行）', async () => {
    const { stdout, stderr } = await runGate(['--path', 'nonexistent-path-xyz-contract-test']);
    const output = stdout + stderr;
    assert.ok(!output.includes('[PASS]'), `stdout 不应含 [PASS]，实际:\n${output}`);
  });

  test('exit 2 不得 exit 0（铁律：禁默认放行）', async () => {
    const { exitCode } = await runGate(['--path', 'nonexistent-path-xyz-contract-test']);
    assert.notStrictEqual(exitCode, 0, '严禁 RTM 缺失时 exit 0（禁默认放行）');
  });
});

// ─── BEHAVIOR-03: 全达标 → exit 0 + [PASS] ──────────────────────────────────

describe('[BEHAVIOR-03] 全达标 → exit 0 + [PASS]', async () => {
  test('exit code 必须为 0', async () => {
    const { exitCode } = await runGate(['--rtm', RTM_ALL_PASS]);
    assert.strictEqual(exitCode, 0, `期望 exit 0，实际 exit ${exitCode}`);
  });

  test('stdout 必须含 [PASS]', async () => {
    const { stdout, stderr } = await runGate(['--rtm', RTM_ALL_PASS]);
    const output = stdout + stderr;
    assert.ok(
      output.includes('[PASS]'),
      `stdout 中未找到 [PASS]。实际输出:\n${output}`
    );
  });

  test('stdout 禁止含 [BLOCKED]（全达标不得误报缺口）', async () => {
    const { stdout, stderr } = await runGate(['--rtm', RTM_ALL_PASS]);
    const output = stdout + stderr;
    assert.ok(!output.includes('[BLOCKED]'), `stdout 不应含 [BLOCKED]，实际:\n${output}`);
  });
});

// ─── BEHAVIOR-04: 非接缝步 L0（承诺≠L0）→ exit 1 ────────────────────────────

describe('[BEHAVIOR-04] 非接缝步 L0（承诺≠L0）→ exit 1', async () => {
  test('exit code 必须为 1（S10 承诺 L2 但实际 L0）', async () => {
    const { exitCode } = await runGate(['--rtm', RTM_L0_STEP]);
    assert.strictEqual(exitCode, 1, `期望 exit 1，实际 exit ${exitCode}`);
  });

  test('stdout 必须含 [BLOCKED]', async () => {
    const { stdout, stderr } = await runGate(['--rtm', RTM_L0_STEP]);
    const output = stdout + stderr;
    assert.ok(
      output.includes('[BLOCKED]'),
      `stdout 中未找到 [BLOCKED]。实际输出:\n${output}`
    );
  });

  test('stdout 必须含非预期 L0 步骤号（如 S10）', async () => {
    const { stdout, stderr } = await runGate(['--rtm', RTM_L0_STEP]);
    const output = stdout + stderr;
    // fixture 中 S10 承诺 L2 实际 L0，应被检出
    assert.ok(output.includes('S10'), `stdout 中未找到 S10。实际输出:\n${output}`);
  });
});

// ─── BEHAVIOR-06: exit 1/exit 2 时不写 decisions（无副作用）─────────────────

describe('[BEHAVIOR-06] exit 1/2 时不写 decisions（INV-01 无副作用）', async () => {
  test('脚本只接受 --rtm 或 --path 参数，不接受 --write 旗帜', async () => {
    // INV-02: 禁止宽松模式或 --force / --write 旗帜
    // 通过 --help 输出验证：不应含 --force 或 --no-gate 参数
    const { stdout, stderr } = await runGate(['--help']);
    const output = stdout + stderr;
    assert.ok(!output.includes('--force'), `help 不应含 --force 旗帜`);
    assert.ok(!output.includes('--no-gate'), `help 不应含 --no-gate 旗帜`);
  });

  test('exit 1/2无decisions POST，保持本地拒绝合同', async () => {
    for (const args of [['--rtm', RTM_WITH_GAPS], ['--path', 'nonexistent-path-xyz-contract-test']]) {
      const result = await runGate(args);
      assert.ok([1, 2].includes(result.exitCode));
      assert.deepEqual(result.requests, []);
    }
  });

  test('PASS真实POST仅到owned decisions端点，正文保持产品合同', async () => {
    const result = await runGate(['--rtm', RTM_ALL_PASS]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.requests.length, 1);
    const request = result.requests[0];
    assert.equal(request.method, 'POST');
    assert.equal(request.url, '/api/brain/decisions');
    assert.deepEqual(JSON.parse(request.body), {
      category: 'release-gate', level: 'feature', topic: 'rtm-all-pass', decision: 'PASS',
      reason: 'All seam-steps meet L3 commit level; release gate approved.',
    });
    assert.match(result.stdout, /decisions 已写库/);
  });

});

// ─── BEHAVIOR-05（CLI 层）: --help exit 0 ────────────────────────────────────

describe('[FR01] --help exit 0', async () => {
  test('node scripts/release-gate.mjs --help → exit 0', async () => {
    const { exitCode } = await runGate(['--help']);
    assert.strictEqual(exitCode, 0, `--help 应 exit 0，实际 exit ${exitCode}`);
  });
});

// ─── RTM 解析能力：通过 fixture 替换验证不依赖 hardcoded 步骤名 ──────────────

describe('[FR10] RTM 解析不硬编码 Path4 步骤名', async () => {
  test('使用自定义 RTM fixture 时，仍能正确解析接缝步等级', async () => {
    // 给定 rtm-all-pass.md（非 path4 默认路径），脚本应正常处理
    const { exitCode } = await runGate(['--rtm', RTM_ALL_PASS]);
    assert.strictEqual(exitCode, 0, `自定义 RTM fixture 应 exit 0，实际 exit ${exitCode}`);
  });

  test('给定 rtm-with-gaps.md（非 path4 默认路径），仍能检出接缝步缺口', async () => {
    const { exitCode } = await runGate(['--rtm', RTM_WITH_GAPS]);
    assert.strictEqual(exitCode, 1, `自定义含缺口 RTM 应 exit 1，实际 exit ${exitCode}`);
  });
});
