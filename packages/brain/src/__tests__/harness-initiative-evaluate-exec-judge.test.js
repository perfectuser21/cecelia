/**
 * TDD — RED phase: evaluate 职责分离
 *
 * 测试 Sprint 06120010-e2e-exec-judge-r2 新增的三个函数：
 *   - executeContractCommands: 代码层执行 BEHAVIOR 命令，返回结构化执行记录
 *   - validateCoverageTable:   Brain 代码校验 coverage 对照表完整性
 *   - isLegacyMode:            检测 EVALUATOR_LEGACY 回退开关
 *
 * 以及 evaluateContractNode 重构后的流程（通过/失败型 fixture + coverage 字段写盘）。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ─── 被测模块（当前 RED：函数不存在，import 后调用会抛 TypeError）───────────
import {
  executeContractCommands,
  validateCoverageTable,
  isLegacyMode,
  runScenarioCommand,       // 已有函数，回归保证不破坏
} from '../harness-final-e2e.js';

// ─── evaluateContractNode（重构后需写 coverage 到结果）──────────────────────
import { evaluateContractNode } from '../workflows/harness-task.graph.js';

// ─── Mock 外部依赖（对齐已有测试风格） ──────────────────────────────────────
vi.mock('../db.js', () => ({
  default: { connect: vi.fn(), query: vi.fn() },
}));

vi.mock('../harness-shared.js', () => ({
  parseDockerOutput: vi.fn((x) => x),
  loadSkillContent: vi.fn(() => 'SKILL_CONTENT'),
  readBrainResult: vi.fn().mockResolvedValue({ verdict: 'PASS' }),
}));

vi.mock('../harness-credentials.js', () => ({
  resolveGitHubToken: vi.fn().mockResolvedValue('fake-token'),
}));

vi.mock('../spawn/middleware/account-rotation.js', () => ({
  resolveAccount: vi.fn().mockResolvedValue({}),
}));

vi.mock('../lib/contract-verify.js', () => ({
  verifyContractArtifactsForPr: vi.fn().mockResolvedValue({ ran: true, ok: true }),
}));

vi.mock('../lib/contract-gate.js', () => ({
  evaluateContractText: vi.fn(),
  formatGateReport: vi.fn(() => ''),
  runContractGate: vi.fn().mockResolvedValue({ ok: true }),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

let tempDir;

beforeEach(() => {
  tempDir = join(tmpdir(), `exec-judge-test-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tempDir, { recursive: true });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
  delete process.env.EVALUATOR_LEGACY;
});

// ─── Section 1: executeContractCommands ──────────────────────────────────────

describe('executeContractCommands — 代码层执行 BEHAVIOR 命令', () => {
  it('通过型 fixture — exit_code=0 + stdout 含输出 + duration_ms 为正数', async () => {
    const result = await executeContractCommands(
      [{ cmd: 'echo hello-fixture', type: 'bash' }],
      { sprintDir: tempDir, runId: 'test-pass-001' }
    );

    expect(result).toHaveProperty('recordPath');
    const record = JSON.parse(readFileSync(result.recordPath, 'utf8'));

    expect(Array.isArray(record.commands)).toBe(true);
    expect(record.commands).toHaveLength(1);

    const c = record.commands[0];
    expect(c.exit_code).toBe(0);
    expect(typeof c.duration_ms).toBe('number');
    expect(c.duration_ms).toBeGreaterThanOrEqual(0);
    expect(typeof c.stdout).toBe('string');
    expect(c.stdout).toContain('hello-fixture');
    expect(typeof c.stderr).toBe('string');
    expect(typeof c.cmd).toBe('string');
  });

  it('失败型 fixture — exit_code 非零 + 失败原文保留于执行记录（不允许 LLM 发明）', async () => {
    const result = await executeContractCommands(
      [{ cmd: 'echo FAIL-MARKER-XYZ >&2 && exit 42', type: 'bash' }],
      { sprintDir: tempDir, runId: 'test-fail-001' }
    );

    const record = JSON.parse(readFileSync(result.recordPath, 'utf8'));
    const c = record.commands[0];

    expect(c.exit_code).not.toBe(0);
    const combined = (c.stdout || '') + ' ' + (c.stderr || '');
    expect(combined).toContain('FAIL-MARKER-XYZ');
  });

  it('多命令混合 — 每条命令独立捕获，前一条失败不阻断后续命令执行', async () => {
    const result = await executeContractCommands(
      [
        { cmd: 'echo cmd1-ok', type: 'bash' },
        { cmd: 'exit 1', type: 'bash' },
        { cmd: 'echo cmd3-ok', type: 'bash' },
      ],
      { sprintDir: tempDir, runId: 'test-multi-001' }
    );

    const record = JSON.parse(readFileSync(result.recordPath, 'utf8'));
    expect(record.commands).toHaveLength(3);
    expect(record.commands[0].exit_code).toBe(0);
    expect(record.commands[1].exit_code).not.toBe(0);
    expect(record.commands[2].exit_code).toBe(0);
  });

  it('stdout/stderr 截断 — 超过阈值保留头尾（TRNK_HEAD/TRNK_TAIL），exit_code 不丢（PRD 边界情况）', async () => {
    // 生成 > 4000 字节：TRNK_HEAD + 5000 A's + TRNK_TAIL，exit 9
    // bytes([]) 方式避免 cmd 字符串中引号嵌套问题
    const cmd = "python3 -c \"import sys; h=bytes([84,82,78,75,95,72,69,65,68]).decode(); t=bytes([84,82,78,75,95,84,65,73,76]).decode(); sys.stdout.write(h+chr(65)*5000+t); sys.exit(9)\"";
    const result = await executeContractCommands(
      [{ cmd, type: 'bash' }],
      { sprintDir: tempDir, runId: 'test-truncate-001' }
    );

    const record = JSON.parse(readFileSync(result.recordPath, 'utf8'));
    const c = record.commands[0];

    // PRD: "不丢 exit_code" — 即使输出超限，exit 码必须正确捕获
    expect(c.exit_code).toBe(9);

    const stdout = c.stdout || '';

    // PRD: "超截断阈值 → stdout ≤ 4000 字节"
    expect(stdout.length).toBeLessThanOrEqual(4000);

    // PRD: "保留头部" — 头部 TRNK_HEAD 标记必须存在
    expect(stdout).toContain('TRNK_HEAD');

    // PRD: "保留尾部" — 尾部 TRNK_TAIL 标记必须存在
    expect(stdout).toContain('TRNK_TAIL');
  });

  it('唯一命名 — 同 sprintDir 下两次调用产生不同 recordPath（对齐 #3345）', async () => {
    const r1 = await executeContractCommands(
      [{ cmd: 'echo run1', type: 'bash' }],
      { sprintDir: tempDir, runId: 'run-aaa' }
    );
    const r2 = await executeContractCommands(
      [{ cmd: 'echo run2', type: 'bash' }],
      { sprintDir: tempDir, runId: 'run-bbb' }
    );

    expect(r1.recordPath).not.toBe(r2.recordPath);
    // 两个文件都应存在
    expect(() => readFileSync(r1.recordPath)).not.toThrow();
    expect(() => readFileSync(r2.recordPath)).not.toThrow();
  });
});

// ─── Section 2: validateCoverageTable ────────────────────────────────────────

describe('validateCoverageTable — Brain 代码覆盖校验', () => {
  const gpSteps = [
    'Step 1: 代码执行层接管',
    'Step 2: 执行记录落盘',
    'Step 3: LLM 裁读输出',
  ];

  it('完整覆盖 — 返回 {ok: true}', () => {
    const coverage = {
      steps: gpSteps.map((step) => ({ step, mapped_cmd: 'echo test', passed: true })),
    };
    const result = validateCoverageTable(coverage, gpSteps);
    expect(result.ok).toBe(true);
  });

  it('缺 1 步 — 返回 {ok: false, missing: [缺失步骤名]}', () => {
    const coverage = {
      steps: [
        { step: 'Step 1: 代码执行层接管', mapped_cmd: 'echo', passed: true },
      ],
    };
    const result = validateCoverageTable(coverage, gpSteps);
    expect(result.ok).toBe(false);
    expect(Array.isArray(result.missing)).toBe(true);
    expect(result.missing).toContain('Step 2: 执行记录落盘');
    expect(result.missing).toContain('Step 3: LLM 裁读输出');
  });

  it('空 steps — 所有 GP 步骤均缺失', () => {
    const result = validateCoverageTable({ steps: [] }, gpSteps);
    expect(result.ok).toBe(false);
    expect(result.missing).toHaveLength(gpSteps.length);
  });

  it('LLM 自称 PASS 时 Brain 代码仍强制 FAIL（不信任 LLM 自述完整性）', () => {
    const incompleteCoverage = {
      steps: [{ step: 'Step 1: 代码执行层接管', mapped_cmd: 'echo', passed: true }],
      llm_verdict: 'PASS',  // LLM 声称通过
    };
    const result = validateCoverageTable(incompleteCoverage, gpSteps);
    expect(result.ok).toBe(false);  // Brain 代码不接受
  });

  it('coverage 对象缺 steps 字段 — 安全返回 {ok: false}', () => {
    const result = validateCoverageTable({}, gpSteps);
    expect(result.ok).toBe(false);
    expect(Array.isArray(result.missing)).toBe(true);
  });
});

// ─── Section 3: isLegacyMode ─────────────────────────────────────────────────

describe('isLegacyMode — 回退开关', () => {
  it('未设 EVALUATOR_LEGACY 时返回 false', () => {
    delete process.env.EVALUATOR_LEGACY;
    expect(isLegacyMode()).toBe(false);
  });

  it('EVALUATOR_LEGACY=1 时返回 true', () => {
    process.env.EVALUATOR_LEGACY = '1';
    expect(isLegacyMode()).toBe(true);
  });

  it('EVALUATOR_LEGACY=true 时返回 true', () => {
    process.env.EVALUATOR_LEGACY = 'true';
    expect(isLegacyMode()).toBe(true);
  });

  it('EVALUATOR_LEGACY=0 时返回 false（仅 "1" 或 "true" 触发回退）', () => {
    process.env.EVALUATOR_LEGACY = '0';
    expect(isLegacyMode()).toBe(false);
  });
});

// ─── Section 4: evaluateContractNode 重构 ────────────────────────────────────

describe('evaluateContractNode — 职责分离重构', () => {
  const baseState = {
    task: {
      id: 'test-task-exec-judge',
      payload: {
        sprint_dir: 'sprints/06120010-e2e-exec-judge-r2',
        journey_type: 'autonomous',
      },
    },
    evaluate_verdict: null,
    pr_url: null,
    worktreePath: null,
    prdContent: [
      '## target_environment: local_api',
      '### Step 1: 代码执行层接管',
      '### Step 2: 执行记录落盘',
      '### Step 3: LLM 裁读输出',
    ].join('\n'),
    githubToken: 'fake-token',
    contractBranch: '',
    pr_branch: '',
  };

  it('通过型 fixture — 调用 executeContractCommands（不是 LLM spawn）且返回 verdict=PASS', async () => {
    const mockExecCommands = vi.fn().mockResolvedValue({
      recordPath: '/tmp/fake-record.json',
      commands: [{ cmd: 'echo ok', exit_code: 0, stdout: 'ok\n', stderr: '', duration_ms: 5 }],
    });
    const mockJudge = vi.fn().mockResolvedValue({
      verdict: 'PASS',
      coverage: {
        steps: [
          { step: 'Step 1: 代码执行层接管', mapped_cmd: 'echo ok', passed: true },
          { step: 'Step 2: 执行记录落盘', mapped_cmd: 'echo ok', passed: true },
          { step: 'Step 3: LLM 裁读输出', mapped_cmd: 'echo ok', passed: true },
        ],
      },
    });

    const result = await evaluateContractNode(baseState, {
      checkPrMerged: async () => false,
      resolveToken: async () => 'tok',
      verifyArtifacts: async () => ({ ran: true, ok: true }),
      runContractGate: async () => ({ ok: true }),
      executeContractCommands: mockExecCommands,
      judgeWithLlm: mockJudge,
    });

    // evaluateContractNode 应调用 executeContractCommands 而非直接 spawn LLM
    expect(mockExecCommands).toHaveBeenCalledOnce();
    // [R5 FIX A] 验证 dispatch 语义：dispatched commands 来自合同 BEHAVIOR 条目，非空（capturedCmds.length > 0）
    const capturedCmds = mockExecCommands.mock.calls[0][0];
    expect(Array.isArray(capturedCmds)).toBe(true);
    expect(capturedCmds.length).toBeGreaterThan(0);
    expect(result.evaluate_verdict).toBe('PASS');
  });

  it('coverage 字段写入结果 — .brain-result.json 新增 coverage（每 GP 步骤有映射）', async () => {
    const coveragePayload = {
      steps: [
        { step: 'Step 1: 代码执行层接管', mapped_cmd: 'echo ok', passed: true },
        { step: 'Step 2: 执行记录落盘', mapped_cmd: 'echo ok', passed: true },
        { step: 'Step 3: LLM 裁读输出', mapped_cmd: 'echo ok', passed: true },
      ],
    };

    const result = await evaluateContractNode(baseState, {
      checkPrMerged: async () => false,
      resolveToken: async () => 'tok',
      verifyArtifacts: async () => ({ ran: true, ok: true }),
      runContractGate: async () => ({ ok: true }),
      executeContractCommands: vi.fn().mockResolvedValue({
        recordPath: '/tmp/fake-record.json',
        commands: [{ cmd: 'echo', exit_code: 0, stdout: '', stderr: '', duration_ms: 1 }],
      }),
      judgeWithLlm: vi.fn().mockResolvedValue({ verdict: 'PASS', coverage: coveragePayload }),
    });

    expect(result.evaluate_verdict).toBe('PASS');
    // coverage 字段必须透传到结果（供 brain-result.json 写入）
    expect(result).toHaveProperty('evaluate_coverage');
    expect(result.evaluate_coverage).toHaveProperty('steps');
    expect(result.evaluate_coverage.steps).toHaveLength(3);
  });

  it('coverage 缺步 — Brain 代码强制 FAIL（即使 judgeWithLlm 返回 PASS）', async () => {
    const result = await evaluateContractNode(baseState, {
      checkPrMerged: async () => false,
      resolveToken: async () => 'tok',
      verifyArtifacts: async () => ({ ran: true, ok: true }),
      runContractGate: async () => ({ ok: true }),
      executeContractCommands: vi.fn().mockResolvedValue({
        recordPath: '/tmp/fake.json',
        commands: [{ cmd: 'echo', exit_code: 0, stdout: '', stderr: '', duration_ms: 1 }],
      }),
      judgeWithLlm: vi.fn().mockResolvedValue({
        verdict: 'PASS',
        coverage: {
          steps: [
            { step: 'Step 1: 代码执行层接管', mapped_cmd: 'echo', passed: true },
            // Step 2 和 Step 3 缺失
          ],
        },
      }),
    });

    // 即使 LLM 说 PASS，coverage 缺步 → Brain 强制 FAIL
    expect(result.evaluate_verdict).toBe('FAIL');
    expect(result.evaluate_error).toMatch(/覆盖.*缺失|missing.*step|coverage/i);
  });

  it('失败型 fixture — verdict=FAIL + failed_step 引用执行记录原文（不许 LLM 发明）', async () => {
    const failOutput = 'ACTUAL-ERROR-FROM-COMMAND-XYZ';

    const result = await evaluateContractNode(baseState, {
      checkPrMerged: async () => false,
      resolveToken: async () => 'tok',
      verifyArtifacts: async () => ({ ran: true, ok: true }),
      runContractGate: async () => ({ ok: true }),
      executeContractCommands: vi.fn().mockResolvedValue({
        recordPath: '/tmp/fake-fail.json',
        commands: [{ cmd: 'false', exit_code: 1, stdout: '', stderr: failOutput, duration_ms: 2 }],
      }),
      judgeWithLlm: vi.fn().mockResolvedValue({
        verdict: 'FAIL',
        failed_step: `命令 false 失败，原文：${failOutput}`,
        coverage: { steps: [] },
      }),
    });

    expect(result.evaluate_verdict).toBe('FAIL');
    // failed_step 必须引用执行记录原文，不许 LLM 发明
    // （evaluateContractNode 负责校验 failed_step 含原始 stderr/stdout 片段）
    expect(result.evaluate_error || result.evaluate_feedback || '').toMatch(
      new RegExp(failOutput.slice(0, 20))
    );
  });

  it('回退开关 — EVALUATOR_LEGACY=1 时不调用 executeContractCommands（走旧路径）', async () => {
    process.env.EVALUATOR_LEGACY = '1';
    const mockExecCommands = vi.fn();
    const mockSpawn = vi.fn().mockResolvedValue({ verdict: 'PASS' });

    await evaluateContractNode(baseState, {
      checkPrMerged: async () => false,
      resolveToken: async () => 'tok',
      verifyArtifacts: async () => ({ ran: true, ok: true }),
      runContractGate: async () => ({ ok: true }),
      executeContractCommands: mockExecCommands,
      spawnDetached: mockSpawn,
    });

    // 回退模式不应调用新执行器
    expect(mockExecCommands).not.toHaveBeenCalled();

    delete process.env.EVALUATOR_LEGACY;
  });
});

// ─── Section 5: 已有函数回归（runScenarioCommand 不破坏）──────────────────────

describe('runScenarioCommand — 回归（不破坏已有行为）', () => {
  it('仍可正常执行并返回 {exitCode, output}', () => {
    const result = runScenarioCommand({ cmd: 'echo regression-ok', type: 'bash' });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('regression-ok');
  });
});
