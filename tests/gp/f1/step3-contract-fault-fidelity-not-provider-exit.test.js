// F1 · step3（造完真验）companion 守卫 — 结构化上报保真透传，根除 provider_exit 语义埋没 [r82]
//
// PRD 要求 5 指定测试放 tests/gp/f1/；本文件是 sprint 冻结主测
// sprints/08291520-kernel-r82-provider-exit-fidelity/tests/r82-provider-exit-fidelity.test.js
// 的 F1 同族守卫层补充行——真 import 同两条被改的边，禁 mock 被改的边。
// 文件名避让 main 已有同族（无 step3-contract-fault-fidelity-* 前缀冲突）。
//
// 病根三实证：r69 attempt 56a09164 / r76 / r77 attempt e022a331。
//   结构化 BLOCKED + CONTRACT_* 家族错误码遇 provider 非零退出，被回执链路覆写/包装成
//   provider_exit，CONTRACT_* 语义埋没 → 合同故障被误当 provider 崩溃、拉进 failed_targets
//   黑名单、按 infrastructure 重试。
//
// 两条被改的真实边（禁 mock 被改的边）：
//   边①【回执保真】packages/brain/scripts/codex-bridge/kernel-attempt-handler.cjs
//   边②【失败目标采集】packages/brain/src/orchestrator/attempt-store.js
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
const ATTEMPT_ID = 'e022a331-1a2b-4c3d-8e4f-0a1b2c3d4e5f';

function writeResultFile(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r82-f1-brain-result-'));
  const file = path.join(dir, '.brain-result.json');
  fs.writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body));
  return file;
}

function structuredBlockedContractFault(code = 'CONTRACT_TEST_UNSATISFIABLE') {
  return {
    contract_version: '1.0',
    attempt_id: ATTEMPT_ID,
    status: 'blocked',
    summary: 'contract test unsatisfiable: 冻结测试无法在不违约前提下变绿',
    artifacts: [],
    checks: [],
    decision: null,
    error: { code, message: 'frozen contract test is unsatisfiable' },
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

describe('r82 F1/step3 · 边① 回执保真（kernel-attempt-handler）', () => {
  it('保真，error.code 不被埋没成 provider_exit：结构化 BLOCKED + CONTRACT_* 遇非零退出仍透传原码', () => {
    const resultPath = writeResultFile(structuredBlockedContractFault());
    const result = kernelAttemptHandler.resolveProviderTerminalResult({
      code: 1,
      resultPath,
      attemptId: ATTEMPT_ID,
    });
    expect(result.status).toBe('blocked');
    expect(result.error?.code).toBe('CONTRACT_TEST_UNSATISFIABLE');
    expect(String(result.error?.code ?? '')).not.toMatch(/^provider_exit/);
  });

  it('真崩溃负向：无结构化产出（文件缺失）+ 非零退出仍 provider_exit（语义不变，零回归）', () => {
    const result = kernelAttemptHandler.resolveProviderTerminalResult({
      code: 137,
      resultPath: path.join(os.tmpdir(), 'r82-f1-does-not-exist', '.brain-result.json'),
      attemptId: ATTEMPT_ID,
    });
    expect(result.status).toBe('failed');
    expect(String(result.error?.code ?? '')).toMatch(/^provider_exit/);
  });
});

describe('r82 F1/step3 · 边② failed_targets 采集（真 attempt-store SQL）', () => {
  it('failed_targets 采集 SQL 排除 CONTRACT_* 家族，合同故障 target 不被拉黑', async () => {
    const pool = stubPool();
    await createAttemptStore(pool).listFailedExecutionTargets(RUN_ID, 'generator');
    const flat = pool.calls[0].sql.replace(/\s+/g, ' ');
    const excludesContractFamily = /error_code[\s\S]*not\s+like\s+'contract/i.test(flat)
      || (/contract_self_contradiction/i.test(flat) && /not\s+in/i.test(flat));
    expect(excludesContractFamily).toBe(true);
    // 时效窗口记仇语义保持（回归保护）
    expect(flat).toMatch(/created_at\s*>=\s*now\(\)\s*-\s*make_interval/i);
  });
});
