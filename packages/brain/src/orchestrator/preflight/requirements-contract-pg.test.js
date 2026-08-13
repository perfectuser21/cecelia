/**
 * requirements-contract-pg.test.js — 合同 → PG capability 机械派生（B-01 / B-02）。
 *
 * 禁 mock 被改的边：直调真实 contractRequiresPostgres / deriveCapabilityRequirements，
 * 传真实合同文本走真实派生逻辑，不 stub。
 */
import { describe, it, expect } from 'vitest';
import {
  contractRequiresPostgres,
  deriveCapabilityRequirements,
} from './requirements.js';

const pgContract = '## E2E\n```bash\npsql "$DB_URL" -c "SELECT 1"\n```';
const noPgContract = '## E2E\n```bash\ncurl -sf localhost:5221/api/brain/health\n```';

describe('合同 → PG capability 机械派生 [BEHAVIOR]', () => {
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

  it('旧签名（无 contract 入参）行为不变：不派生 postgres', () => {
    const req = deriveCapabilityRequirements({ role: 'evaluator', requirements: {} });
    expect(req.postgres).toBe(false);
    expect(req.model_capabilities).toContain('structured_output');
  });

  it('pg_dump / pg_isready 等 pg_* 命令同样派生 postgres', () => {
    expect(contractRequiresPostgres('run: pg_isready -d $DB_URL')).toBe(true);
    expect(contractRequiresPostgres('run: pg_dump mydb > out.sql')).toBe(true);
  });
});
