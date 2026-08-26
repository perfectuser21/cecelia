// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：provider close(exit code) ↔ 已写盘结构化 harness-result
//
// r69 生产实证（attempt 56a09164）：generator 完成完整合同死锁分析（B-06 与 4 道 CI 门禁
// 互斥、无绿态可达、附 4 条最小修法），以结构化 BLOCKED + error_code=CONTRACT_SELF_CONTRADICTION
// 写盘上报。但 codex exec 进程以非零码退出，kernel-attempt-handler 的 close 处理器一刀切
// 把非零退出改写成 provider_exit_N，把已写盘的结构化 error_code 丢弃 → attempt-store 落库
// error_code=provider_exit → derive 当基础设施故障进黑名单重试 → run 空转 2h+ 直到人读日志。
//
// 修法：非零退出时先尝试读已写盘的结构化 harness-result；若是合法的结构化 BLOCKED（带
// error.code 非空字符串）→ 保真透传该 result（禁止降级 provider_exit）；否则（无写盘 / 写盘
// 非法 / 非 blocked 结构化）才回落 provider_exit_N（真崩溃语义不变）。
// 保真透传后，attempt-store.js:110 已把 result.error.code 落库为 error_code，derive.js 既有
// CONTRACT_FAULT_CORE_TOKENS 子集匹配即路由至 ARBITRATE_CONTRACT_FAULT → REOPEN_GAN_CONTRACT。
//
// 按产物闸规矩写在边上：真 require kernel-attempt-handler.cjs（不 mock 被改的边——真 fs 写盘、
// 真 parseHarnessResult 读盘）。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const handler = require('../../../packages/brain/scripts/codex-bridge/kernel-attempt-handler.cjs');

const ATTEMPT_ID = '56a09164-1b2c-4d3e-8f90-0123456789ab';

function validStructuredResult(overrides = {}) {
  return {
    contract_version: '1.0',
    attempt_id: ATTEMPT_ID,
    status: 'blocked',
    summary: '合同死锁分析：B-06 与 4 道 CI 门禁互斥、无绿态可达，附 4 条最小修法',
    artifacts: [],
    checks: [],
    decision: null,
    error: { code: 'CONTRACT_SELF_CONTRADICTION', message: 'B-06 与 required CI 互斥' },
    provider_metadata: { provider: 'codex' },
    ...overrides,
  };
}

let tmpDir;
let resultPath;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r76-contract-fault-'));
  resultPath = path.join(tmpDir, `${ATTEMPT_ID}.result.json`);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('kernel-attempt-handler 合同故障码保真透传（r69 复刻）', () => {
  it('exports reconcileProviderCloseResult as a function', () => {
    expect(typeof handler.reconcileProviderCloseResult).toBe('function');
  });

  it('preserves CONTRACT_SELF_CONTRADICTION structured BLOCKED on non-zero provider exit', () => {
    fs.writeFileSync(resultPath, JSON.stringify(validStructuredResult()));
    const result = handler.reconcileProviderCloseResult({
      code: 1,
      resultPath,
      attemptId: ATTEMPT_ID,
    });
    // 保真透传：状态 blocked、error_code 原样保留，绝不降级 provider_exit
    expect(result.status).toBe('blocked');
    expect(result.error.code).toBe('CONTRACT_SELF_CONTRADICTION');
    expect(result.error.code).not.toMatch(/provider_exit/);
    // downstream 契约：attempt-store.js:110 落库 result.error.code → error_code；
    // derive.js CONTRACT_FAULT_CORE_TOKENS 子集匹配 SELF+CONTRADICTION → 走重开 GAN，不进黑名单
    const tokens = new Set(result.error.code.toUpperCase().split('_').filter(Boolean));
    expect(['SELF', 'CONTRADICTION'].every((t) => tokens.has(t))).toBe(true);
  });

  it('preserves CONTRACT_CI_SCOPE_CONFLICT structured BLOCKED error_code faithfully', () => {
    fs.writeFileSync(resultPath, JSON.stringify(validStructuredResult({
      error: { code: 'CONTRACT_CI_SCOPE_CONFLICT', message: 'test-registry.yaml 登记制冲突' },
    })));
    const result = handler.reconcileProviderCloseResult({
      code: 3,
      resultPath,
      attemptId: ATTEMPT_ID,
    });
    expect(result.status).toBe('blocked');
    expect(result.error.code).toBe('CONTRACT_CI_SCOPE_CONFLICT');
    const tokens = new Set(result.error.code.toUpperCase().split('_').filter(Boolean));
    expect(['CI', 'CONFLICT'].every((t) => tokens.has(t))).toBe(true);
  });

  it('falls back to provider_exit on genuine crash without structured result', () => {
    // 真崩溃：进程非零退出且没有写盘任何结构化 result（负向：语义不变）
    // resultPath 指向不存在的文件
    const result = handler.reconcileProviderCloseResult({
      code: 137,
      resultPath,
      attemptId: ATTEMPT_ID,
    });
    expect(result.status).toBe('failed');
    expect(result.error.code).toBe('provider_exit_137');
    expect(result.error.code).not.toMatch(/CONTRACT/);
  });

  it('falls back to provider_exit when result file is invalid on non-zero exit', () => {
    // 写盘的 result 结构非法（缺字段 / 非 JSON）→ 不是可信结构化上报 → provider_exit（真崩溃族）
    fs.writeFileSync(resultPath, '{ this is not valid harness result');
    const result = handler.reconcileProviderCloseResult({
      code: 2,
      resultPath,
      attemptId: ATTEMPT_ID,
    });
    expect(result.status).toBe('failed');
    expect(result.error.code).toBe('provider_exit_2');
  });

  it('does not misroute non-blocked structured result on non-zero exit to passthrough', () => {
    // 结构化但 status=failed（非 BLOCKED 申诉）→ 按真崩溃族回落 provider_exit，不误入合同透传
    fs.writeFileSync(resultPath, JSON.stringify(validStructuredResult({
      status: 'failed',
      error: { code: 'some_generic_failure', message: 'x' },
    })));
    const result = handler.reconcileProviderCloseResult({
      code: 9,
      resultPath,
      attemptId: ATTEMPT_ID,
    });
    expect(result.error.code).toBe('provider_exit_9');
  });

  it('parses structured result unchanged on zero exit', () => {
    // 回归：零退出路径行为不变——仍解析并保真返回写盘结果
    fs.writeFileSync(resultPath, JSON.stringify(validStructuredResult({
      status: 'completed',
      summary: 'ok',
      error: null,
    })));
    const result = handler.reconcileProviderCloseResult({
      code: 0,
      resultPath,
      attemptId: ATTEMPT_ID,
    });
    expect(result.status).toBe('completed');
    expect(result.error).toBeNull();
  });
});
