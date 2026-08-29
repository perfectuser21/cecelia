// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：回执链路 ↔ kernel 失败归因分流
//
// r69 attempt 56a09164 / r76 / r77 attempt e022a331 实证：generator/commander 的结构化终态
// （success 结果 JSON / 结构化 BLOCKED + CONTRACT_* 家族错误码）在回执链路被降级/包装成
// provider_exit，合同自身故障（应重开 GAN）被误当 provider 进程崩溃，拉进 failed_targets
// 黑名单、按 infrastructure 重试。本守卫落在两条真实的被改边上，禁 mock 被改的边：
//   - 真 require kernel-attempt-handler.cjs，真读临时 .brain-result.json（保真透传）。
//   - 真 createAttemptStore，只 stub 最外层 pg pool 捕获真实 SQL（决策 109dd8eb）。
//
// 纯函数可重放（postgres:false）：无真实 DB、无网络、无 provider 进程。
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

const RUN_ID = '9b7b6a5c-4d3e-42f1-8a09-1122334455aa';
const ATTEMPT_ID = 'e022a331-9f8e-4d7c-8b6a-5c4d3e2f1a0b';

function writeStructuredBlocked(code) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-r82-'));
  const file = path.join(dir, '.brain-result.json');
  fs.writeFileSync(file, JSON.stringify({
    contract_version: '1.0',
    attempt_id: ATTEMPT_ID,
    status: 'blocked',
    summary: 'contract test unsatisfiable',
    artifacts: [],
    checks: [],
    decision: null,
    error: { code, message: 'frozen test unsatisfiable under DoD' },
    provider_metadata: { provider: 'claude', session_id: null },
  }));
  return file;
}

describe('F1/step3 结构化上报保真透传，根除 provider_exit 语义埋没', () => {
  it('CONTRACT_TEST_UNSATISFIABLE 结构化 BLOCKED + 非零退出 → 保真，error.code 不被埋没成 provider_exit', () => {
    const resultPath = writeStructuredBlocked('CONTRACT_TEST_UNSATISFIABLE');
    const result = kernelAttemptHandler.resolveProviderTerminalResult({
      code: 1,
      resultPath,
      attemptId: ATTEMPT_ID,
    });
    expect(result.status).toBe('blocked');
    expect(result.error?.code).toBe('CONTRACT_TEST_UNSATISFIABLE');
    expect(String(result.error?.code ?? '')).not.toMatch(/^provider_exit/);
  });

  it('真崩溃负向（无结构化产出）仍归 provider_exit，黑名单/infra 语义不变', () => {
    const result = kernelAttemptHandler.resolveProviderTerminalResult({
      code: 139,
      resultPath: path.join(os.tmpdir(), 'f1-r82-missing', '.brain-result.json'),
      attemptId: ATTEMPT_ID,
    });
    expect(result.status).toBe('failed');
    expect(String(result.error?.code ?? '')).toMatch(/^provider_exit/);
  });

  it('failed_targets 采集 SQL 排除 CONTRACT_* 家族（真 attempt-store 边）', async () => {
    const calls = [];
    const pool = {
      query: async (sql, params) => {
        calls.push({ sql, params });
        return { rows: [], rowCount: 0 };
      },
    };
    await createAttemptStore(pool).listFailedExecutionTargets(RUN_ID, 'generator');
    const flat = calls[0].sql.replace(/\s+/g, ' ');
    const excludesContractFamily = /error_code[\s\S]*not\s+like\s+'contract/i.test(flat)
      || (/contract_self_contradiction/i.test(flat) && /not\s+in/i.test(flat));
    expect(excludesContractFamily).toBe(true);
  });
});
