import { describe, it, expect, vi } from 'vitest';
import { syncActivityContracts } from '../activity-contract-sync.js';
import { contractsFixture } from './fixtures/shared-activity-contracts.js';
vi.mock('../alerting.js', () => ({ raise: vi.fn() }));
const registrations = [
  { id: 'keyword', capability_id: 'cap-keyword', source_repo: 'perfectuser21/zenithjoy-workspace', source_capability: 'keyword_acquisition', source_workflow: 'social-keyword-leadgen', source_path: 'product-map/contracts/keyword_acquisition.yaml' },
  { id: 'benchmark', capability_id: 'cap-benchmark', source_repo: 'perfectuser21/zenithjoy-workspace', source_capability: 'benchmark_link_acquisition', source_workflow: 'social-benchmark-leadgen', source_path: 'product-map/contracts/benchmark_link_acquisition.yaml' },
];
function db() {
  const query = vi.fn(async sql => ({ rows: /FROM workflows/.test(sql) ? registrations : [] }));
  return { query, connect: vi.fn(async () => ({ query, release: vi.fn() })) };
}
describe('共享活动同步必须先完整验证来源', () => {
  it.each(['digest', 'ref', 'cycle', 'mapping'])('%s 错误必须拒绝且零写入', async mode => {
    const fixture = contractsFixture(), pool = db();
    if (mode === 'digest') fixture.digest.capabilities.benchmark_link_acquisition.sha256 = 'wrong';
    if (mode === 'ref') fixture.docs.benchmark_link_acquisition.activities[0].ref = 'keyword_acquisition.absent';
    if (mode === 'cycle') {
      fixture.docs.benchmark_link_acquisition.activities[0].ref = 'keyword_acquisition.preflight';
      fixture.docs.keyword_acquisition.activities[0] = { ref: 'benchmark_link_acquisition.preflight' };
    }
    if (mode === 'mapping') fixture.docs.benchmark_link_acquisition.workflow = 'wrong-workflow';
    await expect(syncActivityContracts(pool, fixture)).rejects.toThrow();
    expect(pool.query.mock.calls.some(([sql]) => /INSERT|UPDATE|DELETE/.test(sql))).toBe(false);
  });
});
