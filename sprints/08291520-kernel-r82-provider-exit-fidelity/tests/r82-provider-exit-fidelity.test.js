// Sprint r82 — 结构化上报保真透传，根除 provider_exit 语义埋没
//
// 覆盖父路 F1「工厂·开发闭环」第 3 步（造完真验）失败归因分流接缝。
//
// 病根三实证（RED 先行复刻）：
//   r69 attempt 56a09164 / r76 / r77 attempt e022a331 —— generator/commander 产出结构化
//   BLOCKED + CONTRACT_* 家族错误码，但因 provider CLI 非零退出，回执链路把整份结构化终态
//   覆写/包装成 {status:failed, error.code:provider_exit}，CONTRACT_* 被埋没 → kernel 误当
//   provider 进程崩溃 → 拉进 failed_targets 黑名单、按 infrastructure 重试，"失败不留原因"。
//
// 两条被改的真实边（禁 mock 被改的边）：
//   边①【回执保真】packages/brain/scripts/codex-bridge/kernel-attempt-handler.cjs
//        —— 真 require 被改模块，真读临时 .brain-result.json（不 mock fs/不 mock 解析）。
//   边②【失败目标采集】packages/brain/src/orchestrator/attempt-store.js
//        —— 真 createAttemptStore，只 stub 最外层 pg pool 捕获实际发往 Postgres 的 SQL 文本
//        （决策 109dd8eb：守卫用真零件跑，SQL 文本即真实模块行为，非源码文本自证）。
//
// 纯函数可重放：无真实 DB（postgres:false），无网络，无 provider 进程。
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createAttemptStore } from '../../../packages/brain/src/orchestrator/attempt-store.js';

const require = createRequire(import.meta.url);
const kernelAttemptHandler = require(
  '../../../packages/brain/scripts/codex-bridge/kernel-attempt-handler.cjs',
);

const RUN_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const ATTEMPT_ID = '56a09164-1a2b-4c3d-8e4f-0a1b2c3d4e5f';

function writeResultFile(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r82-brain-result-'));
  const file = path.join(dir, '.brain-result.json');
  fs.writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body));
  return file;
}

function structuredBlockedContractFault(code = 'CONTRACT_SELF_CONTRADICTION') {
  return {
    contract_version: '1.0',
    attempt_id: ATTEMPT_ID,
    status: 'blocked',
    summary: 'contract self-contradiction: DoD 与冻结测试互斥，无法在不违约前提下满足',
    artifacts: [],
    checks: [],
    decision: null,
    error: { code, message: 'contract asset is self-contradictory' },
    provider_metadata: { provider: 'claude', session_id: null },
  };
}

function structuredCompleted() {
  return {
    contract_version: '1.0',
    attempt_id: ATTEMPT_ID,
    status: 'completed',
    summary: 'ok',
    artifacts: [],
    checks: [],
    decision: null,
    error: null,
    provider_metadata: { provider: 'claude', session_id: null },
  };
}

function stubPool(rows = []) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows, rowCount: rows.length };
    },
  };
}

describe('r82 边① 回执保真透传（kernel-attempt-handler resolveProviderTerminalResult）', () => {
  it('导出纯函数 resolveProviderTerminalResult（回执归因 SSOT，可被 close-handler 与守卫共用）', () => {
    expect(typeof kernelAttemptHandler.resolveProviderTerminalResult).toBe('function');
  });

  it('复刻 r69/r77：结构化 BLOCKED + CONTRACT_* 遇 provider 非零退出，保真透传不被包装成 provider_exit', () => {
    const resultPath = writeResultFile(structuredBlockedContractFault());
    const result = kernelAttemptHandler.resolveProviderTerminalResult({
      code: 1,
      resultPath,
      attemptId: ATTEMPT_ID,
    });
    expect(result.status).toBe('blocked');
    expect(result.error?.code).toBe('CONTRACT_SELF_CONTRADICTION');
    // 语义未被埋没：绝不能出现 provider_exit* 家族码
    expect(String(result.error?.code ?? '')).not.toMatch(/^provider_exit/);
  });

  it('success 结果 JSON（completed）遇非零退出同样保真，不被误判为失败', () => {
    const resultPath = writeResultFile(structuredCompleted());
    const result = kernelAttemptHandler.resolveProviderTerminalResult({
      code: 1,
      resultPath,
      attemptId: ATTEMPT_ID,
    });
    expect(result.status).toBe('completed');
  });

  it('负向不回退：无合法结构化产出（文件缺失）+ 非零退出 → 仍 provider_exit（语义不变）', () => {
    const result = kernelAttemptHandler.resolveProviderTerminalResult({
      code: 137,
      resultPath: path.join(os.tmpdir(), 'r82-does-not-exist', '.brain-result.json'),
      attemptId: ATTEMPT_ID,
    });
    expect(result.status).toBe('failed');
    expect(String(result.error?.code ?? '')).toMatch(/^provider_exit/);
  });

  it('负向不回退：结构化产出损坏（schema 不合法）+ 非零退出 → 落负向路径，不冒充 CONTRACT 故障', () => {
    const resultPath = writeResultFile('{ not valid json');
    const result = kernelAttemptHandler.resolveProviderTerminalResult({
      code: 1,
      resultPath,
      attemptId: ATTEMPT_ID,
    });
    expect(result.status).toBe('failed');
    expect(String(result.error?.code ?? '')).not.toMatch(/^CONTRACT_/);
  });
});

describe('r82 边② failed_targets 采集排除 CONTRACT_* 家族（真 attempt-store SQL）', () => {
  it('listFailedExecutionTargets 发往 Postgres 的 SQL 显式排除 CONTRACT_* 错误码，合同故障 target 不被拉黑', async () => {
    const pool = stubPool();
    await createAttemptStore(pool).listFailedExecutionTargets(RUN_ID, 'generator');
    const flat = pool.calls[0].sql.replace(/\s+/g, ' ');
    // CONTRACT_* 家族属"合同资产自身 bug"，不是 target/机器的错——采集查询必须把它排除在黑名单外。
    // 兼容两种实现：NOT LIKE 'CONTRACT_%' 家族前缀排除，或 NOT IN 列举已知 CONTRACT 码。
    const excludesContractFamily = /error_code[\s\S]*not\s+like\s+'contract/i.test(flat)
      || (/contract_self_contradiction/i.test(flat) && /not\s+in/i.test(flat));
    expect(excludesContractFamily).toBe(true);
    // 时效窗口记仇语义保持（回归保护，不得被本次改动误删）
    expect(flat).toMatch(/created_at\s*>=\s*now\(\)\s*-\s*make_interval/i);
  });
});
