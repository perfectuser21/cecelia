// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 失败归因分流接缝 companion 守卫
//
// 与 sprints/08291520-kernel-r82-provider-exit-fidelity 冻结主测同族，落在 PRD 指定的
// tests/gp/f1/ 位置（文件名避让 main 已有 step3-* 同族）。真 import 两条被改的真实边：
//   边①【回执保真】packages/brain/scripts/codex-bridge/kernel-attempt-handler.cjs
//        resolveProviderTerminalResult —— 结构化终态存在时保真透传，退出码不得埋没 error.code。
//   边②【失败目标采集】packages/brain/src/orchestrator/attempt-store.js
//        listFailedExecutionTargets —— 发往 Postgres 的 SQL 排除 CONTRACT_* 家族。
//
// 病根三实证（r69 attempt 56a09164 / r76 / r77 attempt e022a331）：结构化 BLOCKED + CONTRACT_*
// 因 provider CLI 非零退出被覆写成 {status:failed, error.code:provider_exit}，合同故障被误当
// 进程崩溃拉黑重试。决策 109dd8eb：守卫用真零件跑，不许把被改模块 vi.mock 掉。
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

const RUN_ID = '22222222-2222-4222-8222-222222222222';
const ATTEMPT_ID = 'e022a331-1a2b-4c3d-8e4f-0a1b2c3d4e5f';

function writeResultFile(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r82-companion-'));
  const file = path.join(dir, '.brain-result.json');
  fs.writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body));
  return file;
}

function structuredBlockedContractFault() {
  return {
    contract_version: '1.0',
    attempt_id: ATTEMPT_ID,
    status: 'blocked',
    summary: 'contract self-contradiction',
    artifacts: [],
    checks: [],
    decision: null,
    error: { code: 'CONTRACT_SELF_CONTRADICTION', message: 'contract asset self-contradictory' },
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

describe('F1/step3 companion — 保真：结构化 error.code 不被埋没成 provider_exit（真 kernel-attempt-handler 边）', () => {
  it('结构化 BLOCKED + CONTRACT_* 遇非零退出，保真透传不被包装成 provider_exit', () => {
    const resultPath = writeResultFile(structuredBlockedContractFault());
    const result = kernelAttemptHandler.resolveProviderTerminalResult({
      code: 1,
      resultPath,
      attemptId: ATTEMPT_ID,
    });
    expect(result.status).toBe('blocked');
    expect(result.error?.code).toBe('CONTRACT_SELF_CONTRADICTION');
    expect(String(result.error?.code ?? '')).not.toMatch(/^provider_exit/);
  });

  it('真崩溃负向：无结构化产出（文件缺失）+ 非零退出仍归 provider_exit（语义不变）', () => {
    const result = kernelAttemptHandler.resolveProviderTerminalResult({
      code: 137,
      resultPath: path.join(os.tmpdir(), 'r82-companion-missing', '.brain-result.json'),
      attemptId: ATTEMPT_ID,
    });
    expect(result.status).toBe('failed');
    expect(String(result.error?.code ?? '')).toMatch(/^provider_exit/);
  });
});

describe('F1/step3 companion — failed_targets 采集 SQL 排除 CONTRACT_* 家族（真 attempt-store 边）', () => {
  it('listFailedExecutionTargets 发往 Postgres 的 SQL 显式排除 CONTRACT_* 家族，且时效窗口谓词保留', async () => {
    const pool = stubPool();
    await createAttemptStore(pool).listFailedExecutionTargets(RUN_ID, 'generator');
    const flat = pool.calls[0].sql.replace(/\s+/g, ' ');
    const excludesContractFamily = /error_code[\s\S]*not\s+like\s+'contract/i.test(flat)
      || (/contract_self_contradiction/i.test(flat) && /not\s+in/i.test(flat));
    expect(excludesContractFamily).toBe(true);
    expect(flat).toMatch(/created_at\s*>=\s*now\(\)\s*-\s*make_interval/i);
  });
});
