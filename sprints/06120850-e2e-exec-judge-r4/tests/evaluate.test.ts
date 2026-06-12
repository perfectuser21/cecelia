import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import path from 'path';
import os from 'os';

// --- TDD Red Phase: evaluate.js / runner.js / e2e-judge.js 均未实现 ---
// 预期：所有 it() 块 FAIL（模块不存在或接口不符）

const EVAL_MODULE = path.join(process.cwd(), 'packages/engine/src/harness/evaluate.js');
const RUNNER_MODULE = path.join(process.cwd(), 'packages/engine/src/harness/runner.js');
const JUDGE_MODULE = path.join(process.cwd(), 'packages/engine/src/harness/e2e-judge.js');

describe('runner.executeAndRecord — 执行记录 schema', () => {
  let runner: typeof import('../../packages/engine/src/harness/runner.js');

  beforeEach(async () => {
    vi.resetModules();
    runner = await import(RUNNER_MODULE);
  });

  it('executeAndRecord 导出存在', () => {
    expect(typeof runner.executeAndRecord).toBe('function');
  });

  it('通过型脚本 → exit_code=0 / stdout 非空 / duration_ms≥0', async () => {
    const record = await runner.executeAndRecord({ cmd: 'echo "hello_runner"', type: 'bash' }, {});
    expect(record.exit_code).toBe(0);
    expect(record.stdout.length).toBeGreaterThan(0);
    expect(record.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('失败型脚本 → exit_code 非零', async () => {
    const record = await runner.executeAndRecord({ cmd: 'echo ERR >&2; exit 1', type: 'bash' }, {});
    expect(record.exit_code).not.toBe(0);
  });

  it('记录含 run_id / started_at 字段', async () => {
    const record = await runner.executeAndRecord({ cmd: 'echo ok', type: 'bash' }, {});
    expect(record.run_id).toBeDefined();
    expect(typeof record.started_at).toBe('string');
  });

  it('落盘到 sprint_dir/exec-records/<run_id>.json', async () => {
    const tmpDir = path.join(os.tmpdir(), 'eval-test-' + process.hrtime.bigint());
    mkdirSync(path.join(tmpDir, 'exec-records'), { recursive: true });
    const record = await runner.executeAndRecord(
      { cmd: 'echo "file_test"', type: 'bash' },
      { sprintDir: tmpDir }
    );
    const { existsSync, readFileSync } = await import('fs');
    const recordFile = path.join(tmpDir, 'exec-records', `${record.run_id}.json`);
    expect(existsSync(recordFile)).toBe(true);
    const parsed = JSON.parse(readFileSync(recordFile, 'utf8'));
    expect(parsed.exit_code).toBe(0);
    rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('e2e-judge.judgeExecution — LLM 裁读接口', () => {
  let judge: typeof import('../../packages/engine/src/harness/e2e-judge.js');

  beforeEach(async () => {
    vi.resetModules();
    judge = await import(JUDGE_MODULE);
  });

  it('judgeExecution 导出存在', () => {
    expect(typeof judge.judgeExecution).toBe('function');
  });

  it('执行记录为空（stdout=""）→ 不调用 LLM，直接返回 verdict=FAIL', async () => {
    const emptyRecord = { exit_code: 0, stdout: '', stderr: '', duration_ms: 0, run_id: 'test' };
    const result = await judge.judgeExecution(emptyRecord, '# contract', '# gp', { skipLlm: true });
    expect(result.verdict).toBe('FAIL');
    expect(result.feedback).toMatch(/空|empty/i);
  });

  it('judgeExecution 返回含 coverage 数组（step/passed/record_segment 字段）', async () => {
    const record = { exit_code: 0, stdout: 'EXEC_SENTINEL_XK9W step1_ok', stderr: '', duration_ms: 100, run_id: 'r1' };
    const mockLlm = vi.fn().mockResolvedValue({
      verdict: 'PASS',
      coverage: [
        { step: 'Step 1', record_segment: 'EXEC_SENTINEL_XK9W step1_ok', passed: true },
        { step: 'Step 2', record_segment: 'EXEC_SENTINEL_XK9W step1_ok', passed: true },
      ],
    });
    const result = await judge.judgeExecution(record, '# contract', '# gp', { llmFn: mockLlm });
    expect(result.verdict).toBe('PASS');
    expect(Array.isArray(result.coverage)).toBe(true);
    expect(result.coverage[0]).toHaveProperty('step');
    expect(result.coverage[0]).toHaveProperty('passed');
    expect(result.coverage[0]).toHaveProperty('record_segment');
  });

  it('record_segment 内容真实性 — 必须来自执行记录 stdout，含已知 sentinel', async () => {
    const sentinel = 'EXEC_SENTINEL_XK9W';
    const record = { exit_code: 0, stdout: `${sentinel}: execution_verified`, stderr: '', duration_ms: 50, run_id: 'r2' };
    const mockLlm = vi.fn().mockResolvedValue({
      verdict: 'PASS',
      coverage: [
        { step: 'Step 1', record_segment: `${sentinel}: execution_verified`, passed: true },
      ],
    });
    const result = await judge.judgeExecution(record, '# contract', '# gp', { llmFn: mockLlm });
    const allSegments = result.coverage.map((c: { record_segment?: string }) => c.record_segment ?? '').join(' ');
    expect(allSegments).toContain(sentinel);
  });
});

describe('evaluate.runEvaluate — 编排 + 回退开关', () => {
  let evaluate: typeof import('../../packages/engine/src/harness/evaluate.js');

  beforeEach(async () => {
    vi.resetModules();
    delete process.env.EVAL_LEGACY;
    delete process.env.EVAL_PAYLOAD;
    evaluate = await import(EVAL_MODULE);
  });

  afterEach(() => {
    delete process.env.EVAL_LEGACY;
    delete process.env.EVAL_PAYLOAD;
  });

  it('runEvaluate 导出存在', () => {
    expect(typeof evaluate.runEvaluate).toBe('function');
  });

  it('parseE2EScript 导出存在（解析合同文件 E2E 验收段落）', () => {
    expect(typeof evaluate.parseE2EScript).toBe('function');
  });

  it('EVAL_LEGACY=1 → 跳过新执行器，不写执行记录', async () => {
    process.env.EVAL_LEGACY = '1';
    const tmpDir = path.join(os.tmpdir(), 'eval-legacy-' + process.hrtime.bigint());
    mkdirSync(path.join(tmpDir, 'exec-records'), { recursive: true });

    const mockRunner = vi.fn();
    await evaluate.runEvaluate(
      { cmd: 'echo test', type: 'bash' },
      '# contract',
      '# golden_path',
      { sprintDir: tmpDir, runnerFn: mockRunner, legacy: true }
    );

    expect(mockRunner).not.toHaveBeenCalled();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('EVAL_PAYLOAD use_legacy_eval:true → 跳过新执行器，不写执行记录（payload 回退机制独立于 env var）', async () => {
    process.env.EVAL_PAYLOAD = JSON.stringify({ use_legacy_eval: true });
    const tmpDir = path.join(os.tmpdir(), 'eval-payload-' + process.hrtime.bigint());
    mkdirSync(path.join(tmpDir, 'exec-records'), { recursive: true });

    const mockRunner = vi.fn();
    await evaluate.runEvaluate(
      { cmd: 'echo test', type: 'bash' },
      '# contract',
      '# golden_path',
      { sprintDir: tmpDir, runnerFn: mockRunner }
    );

    expect(mockRunner).not.toHaveBeenCalled();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('brain-result.json 输出同时含 verdict 和 coverage 字段', async () => {
    const tmpDir = path.join(os.tmpdir(), 'eval-schema-' + process.hrtime.bigint());
    mkdirSync(path.join(tmpDir, 'exec-records'), { recursive: true });

    const mockRunner = vi.fn().mockResolvedValue({
      exit_code: 0, stdout: 'ok', stderr: '', duration_ms: 50, run_id: 'r-test',
    });
    const mockJudge = vi.fn().mockResolvedValue({
      verdict: 'PASS',
      coverage: [{ step: 'Step 1', record_segment: 'ok', passed: true }],
    });

    const result = await evaluate.runEvaluate(
      { cmd: 'echo ok', type: 'bash' },
      '# contract',
      '# golden_path',
      { sprintDir: tmpDir, runnerFn: mockRunner, judgeFn: mockJudge }
    );

    expect(result).toHaveProperty('verdict');
    expect(result).toHaveProperty('coverage');
    expect(result.verdict).toBe('PASS');
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('self-hosting 自验 — local_api E2E 模式 fixture → coverage ≥ 5 步', async () => {
    const tmpDir = path.join(os.tmpdir(), 'eval-selfhost-' + process.hrtime.bigint());
    mkdirSync(path.join(tmpDir, 'exec-records'), { recursive: true });

    const selfHostingStdout = [
      'self_hosting_step1: evaluate node received contract OK',
      'self_hosting_step2: code executed in runner container exit=0',
      'self_hosting_step3: structured execution record captured',
      'self_hosting_step4: coverage table validated by Brain',
      'self_hosting_step5: brain-result.json written',
    ].join('\n');

    const mockRunner = vi.fn().mockResolvedValue({
      exit_code: 0, stdout: selfHostingStdout, stderr: '', duration_ms: 80, run_id: 'r-self',
    });
    const mockJudge = vi.fn().mockResolvedValue({
      verdict: 'PASS',
      coverage: [1, 2, 3, 4, 5].map(i => ({
        step: `Step ${i}`,
        record_segment: `self_hosting_step${i}`,
        passed: true,
      })),
    });

    const result = await evaluate.runEvaluate(
      { cmd: 'echo self_hosting', type: 'bash' },
      '# contract',
      '# golden_path',
      { sprintDir: tmpDir, runnerFn: mockRunner, judgeFn: mockJudge }
    );

    expect(result.verdict).toBe('PASS');
    expect(result.coverage.length).toBeGreaterThanOrEqual(5);
    rmSync(tmpDir, { recursive: true, force: true });
  });
});
