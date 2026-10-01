import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { recalculateKrProgress } from '../kr-recalculate-progress.js';
import { updateKrProgress } from '../../kr-progress.js';

describe('公司经营KR不接受项目任务比例覆盖', () => {
  it('重算与callback helper直接返回经营指标，不查询或写项目比例', async () => {
    const row = { id: 'company', progress: 0, current_value: '2.00', target_value: '8.00', metadata: { metric_mode: 'company_formula_v1', company_metric: { current: '2', target: '8', ratio: 0.25 } }, custom_props: { company_notion: { page_id: 'source' } } };
    for (const handler of [recalculateKrProgress, updateKrProgress]) {
      const pool = { query: vi.fn(async () => ({ rows: [row] })) };
      const result = await handler(pool, row.id);
      expect(result).toMatchObject({ skipped: true, reason: 'company_metric' });
      expect(pool.query).toHaveBeenCalledOnce();
    }
  });
  it('三条legacy Current writer必须在实际UPDATE处守住双身份字段', () => {
    for (const file of ['callback-processor.js', 'routes/execution.js', 'routes/tasks.js']) {
      const source = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
      const writes = source.match(/(?:'|`)(UPDATE key_results SET current_value[^'`]*)(?:'|`)/g) || [];
      expect(writes.length).toBeGreaterThan(0);
      expect(writes.every(sql => sql.includes('COMPANY_KR_SQL_GUARD'))).toBe(true);
    }
  });
});
