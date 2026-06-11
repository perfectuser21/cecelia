/**
 * TDD Red Tests — evaluateContractNode 职责分离（代码执行 + LLM 裁读）
 * Sprint: sprints/06120545-e2e-exec-judge-r3
 *
 * RED 状态（实现前）：ExecutionRecordSchema 未导出 → undefined → 调用 .safeParse 报错；
 *                     EvaluatorOutputSchema.shape 无 coverage → 断言失败；
 *                     源码无 EVALUATE_PATH/execution-record → grep 测试失败
 * GREEN 状态（实现后）：所有测试通过
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ExecutionRecordSchema 实现前为 undefined → 以下所有用到它的测试 FAIL（TypeError 或断言失败）
// EvaluatorOutputSchema 已存在但实现前 .shape 无 coverage → coverage 相关测试 FAIL
import { ExecutionRecordSchema, EvaluatorOutputSchema } from '../../../packages/brain/src/harness-shared.js';

// ─── Step 2: 代码执行段 — ExecutionRecordSchema schema ───────────────────────
describe('Step 2 — ExecutionRecordSchema（代码执行段 schema）[BEHAVIOR]', () => {
  it('ExecutionRecordSchema 已从 harness-shared.js 导出', () => {
    // RED: harness-shared.js 未导出 ExecutionRecordSchema → undefined → fail
    expect(ExecutionRecordSchema).toBeDefined();
  });

  it('正常执行记录（exitCode=0）parse 成功，含必要字段', () => {
    const r = (ExecutionRecordSchema as any).safeParse({
      commands: [{ cmd: 'echo ok', exitCode: 0, stdout: 'ok', stderr: '', elapsedMs: 10 }],
    });
    expect(r.success).toBe(true);
    expect(r.data.commands[0].exitCode).toBe(0);
    expect(r.data.commands[0].stdout).toBe('ok');
    expect(r.data.commands[0].elapsedMs).toBe(10);
  });

  it('失败型 fixture — exitCode=1 + stderr 如实保留（不丢弃失败输出）', () => {
    const r = (ExecutionRecordSchema as any).safeParse({
      commands: [{ cmd: 'false', exitCode: 1, stdout: '', stderr: 'command not found', elapsedMs: 5 }],
    });
    expect(r.success).toBe(true);
    expect(r.data.commands[0].exitCode).toBe(1);
    expect(r.data.commands[0].stderr).toBe('command not found');
  });

  it('多条命令（含混合 exitCode）parse 成功', () => {
    const r = (ExecutionRecordSchema as any).safeParse({
      commands: [
        { cmd: 'echo pass', exitCode: 0, stdout: 'pass', stderr: '', elapsedMs: 3 },
        { cmd: 'false',     exitCode: 1, stdout: '',     stderr: 'error', elapsedMs: 2 },
      ],
    });
    expect(r.success).toBe(true);
    expect(r.data.commands).toHaveLength(2);
    expect(r.data.commands[1].exitCode).toBe(1);
  });
});

// ─── Step 3: LLM 裁读 — EvaluatorOutputSchema coverage 字段 ─────────────────
describe('Step 3 — EvaluatorOutputSchema coverage 字段（LLM 裁读输出）[BEHAVIOR]', () => {
  it('EvaluatorOutputSchema.shape 含 coverage 字段', () => {
    // RED: 当前 EvaluatorOutputSchema.shape 无 coverage → fail
    const shape = (EvaluatorOutputSchema as any).shape;
    expect(shape).toHaveProperty('coverage');
  });

  it('PASS verdict + coverage 数组 parse 成功', () => {
    const r = EvaluatorOutputSchema.safeParse({
      verdict: 'PASS',
      coverage: [
        { step: 'Step 1', passed: true },
        { step: 'Step 2', passed: true },
        { step: 'Step 3', passed: true },
      ],
    });
    expect(r.success).toBe(true);
    expect(r.data?.coverage).toHaveLength(3);
  });

  it('失败型 fixture — FAIL verdict + failed_step + coverage 含失败步 parse 成功', () => {
    const r = EvaluatorOutputSchema.safeParse({
      verdict: 'FAIL',
      failed_step: 'Step 2: 代码执行段',
      feedback: 'exit code 1 on: false; fix_direction: check command syntax',
      coverage: [
        { step: 'Step 1', passed: true },
        { step: 'Step 2', passed: false },
      ],
    });
    expect(r.success).toBe(true);
    const failedStep = r.data?.coverage?.find((c: any) => c.step === 'Step 2');
    expect(failedStep?.passed).toBe(false);
  });

  it('coverage 为 undefined 时 PASS verdict 仍合法（optional 字段）', () => {
    const r = EvaluatorOutputSchema.safeParse({ verdict: 'PASS' });
    expect(r.success).toBe(true);
  });
});

// ─── Step 4: Brain 代码校验 — 源码静态检查 ──────────────────────────────────
describe('Step 4 — Brain coverage 覆盖完整性校验（代码判，非 LLM）[BEHAVIOR]', () => {
  const graphSrc = readFileSync(
    resolve(__dirname, '../../../packages/brain/src/workflows/harness-task.graph.js'),
    'utf8'
  );

  it('evaluateContractNode 源码含 coverage 覆盖完整性检查逻辑（Brain 代码判，非 LLM）', () => {
    // RED: 当前 evaluateContractNode 无 coverage 校验 → 此模式不匹配 → fail
    expect(graphSrc).toMatch(/coverage.*miss|miss.*coverage|incomplete.*coverage|coverage.*FAIL|validateCoverage|checkCoverage|coverageMissing|missing.*step/i);
  });

  it('evaluateContractNode 源码含 EVALUATE_PATH legacy 回退开关', () => {
    // RED: 当前源码无 EVALUATE_PATH → fail
    expect(graphSrc).toMatch(/EVALUATE_PATH|evaluate_path|legacy.*path|path.*legacy/i);
  });

  it('evaluateContractNode 源码含 execution-record.json 写入（代码执行段产物）', () => {
    // RED: 当前源码无 execution-record → fail
    const hasRecord =
      graphSrc.includes('execution-record') ||
      graphSrc.includes('executionRecord') ||
      graphSrc.includes('execution_record');
    expect(hasRecord).toBe(true);
  });
});

// ─── Step 2 补充: 代码执行段函数存在 ─────────────────────────────────────────
describe('Step 2 补充 — 代码执行段函数已导出（harness-e2e-runner.js 或 harness-final-e2e.js）[BEHAVIOR]', () => {
  it('代码执行段函数已导出（新文件 harness-e2e-runner.js 或扩展 harness-final-e2e.js）', async () => {
    // RED: harness-e2e-runner.js 不存在 + harness-final-e2e.js 无执行函数 → execFn=undefined → fail
    let execFn: unknown;
    try {
      const m = await import('../../../packages/brain/src/harness-e2e-runner.js');
      execFn = (m as any).runE2eScriptCommands
             || (m as any).runContractE2eCommands
             || (m as any).runE2eCommands;
    } catch {
      // 新文件不存在，fallback 到 harness-final-e2e.js
      const m = await import('../../../packages/brain/src/harness-final-e2e.js');
      execFn = (m as any).runE2eScriptCommands
             || (m as any).runContractE2eCommands
             || (m as any).runE2eCommands;
    }
    expect(typeof execFn).toBe('function');
  });
});
