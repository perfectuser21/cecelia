/**
 * TDD Red 证据 — Harness Evaluator 真环境取证闭环 r2。
 *
 * 本文件是 proposer 的 Red 阶段证据（GAN 合同随附）。它 import 真实 orchestrator
 * 模块，断言本 sprint 新增/强化的可观测行为。当前实现尚未落地 → 全部 RED。
 * generator 落地后，永久回归测试住在 packages/brain 各 __tests__ 目录（见 contract Test Contract）。
 *
 * 禁 mock 被改的边：本文件直调真实函数，不 mock requirements/execution-contract。
 */
import { describe, it, expect } from 'vitest';
import {
  contractRequiresPostgres,
  deriveCapabilityRequirements,
} from '../../../packages/brain/src/orchestrator/preflight/requirements.js';

describe('合同 → PG capability 机械派生 [BEHAVIOR]', () => {
  const pgContract = '## E2E\n```bash\npsql "$DB_URL" -c "SELECT 1"\n```';
  const noPgContract = '## E2E\n```bash\ncurl -sf localhost:5221/api/brain/health\n```';

  it('合同含 psql 命令派生 postgres 为 true', () => {
    expect(contractRequiresPostgres(pgContract)).toBe(true);
    const req = deriveCapabilityRequirements({
      role: 'evaluator',
      requirements: {},
      contract: pgContract,
    });
    expect(req.postgres).toBe(true);
  });

  it('无 PG 要求合同派生 postgres 为 false', () => {
    expect(contractRequiresPostgres(noPgContract)).toBe(false);
    const req = deriveCapabilityRequirements({
      role: 'evaluator',
      requirements: {},
      contract: noPgContract,
    });
    expect(req.postgres).toBe(false);
  });
});
