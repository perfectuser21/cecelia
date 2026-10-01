#!/usr/bin/env bash
set -euo pipefail
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
BRAIN_URL="${BRAIN_URL%/}"
BRAIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$BRAIN_ROOT"
RESPONSE="$(curl -fsS --max-time 15 "$BRAIN_URL/api/brain/okr/company-key-results")"
node --input-type=module - "$RESPONSE" <<'JS'
import assert from 'node:assert/strict';
import { COMPANY_KR_CATALOG, COMPANY_METRIC_MODE, companyMetric } from './src/lib/company-kr-metrics.js';
const body = JSON.parse(process.argv[2]);
assert.equal(body.success, true);
assert.ok(Array.isArray(body.items));
if (body.items.length) {
  assert.equal(body.items.length, COMPANY_KR_CATALOG.length, '公司集合必须完整8条');
  const sources = new Map(COMPANY_KR_CATALOG.map(item => [item.page_id, item]));
  const seen = new Set();
  for (const item of body.items) {
    const source = sources.get(item.source_page_id);
    assert.ok(source && !seen.has(item.source_page_id), '未知或重复公司来源');
    seen.add(item.source_page_id);
    assert.equal(item.source_goal_id, source.goal_id);
    assert.equal(item.unit, source.unit);
    assert.equal(item.metric_mode, COMPANY_METRIC_MODE);
    assert.ok(Array.isArray(item.source_area_ids));
    assert.ok(['unverified', 'verified_observation'].includes(item.validation_state));
    assert.ok(Number.isFinite(Date.parse(item.updated_at)), '缺合法观察版本');
    for (const field of ['start_value', 'current_value', 'target_value']) {
      assert.ok(item[field] === null || (typeof item[field] === 'string' && /^[+-]?\d+(?:\.\d+)?$/.test(item[field])), `${field} 必须保留raw字符串或null`);
    }
    const metric = companyMetric(item.start_value, item.current_value, item.target_value);
    assert.equal(item.progress_ratio, metric.ratio, 'fraction必须保留原公式三位精度');
    assert.equal(item.progress_pct, metric.ratio === null ? null : Number((metric.ratio * 100).toFixed(1)));
  }
}
console.info(`公司 KR 只读合同验证：${body.items.length} 条${body.items.length ? '' : '（尚未导入）'}`);
JS
