#!/usr/bin/env bash
set -euo pipefail
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
BRAIN_URL="${BRAIN_URL%/}"
BRAIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$BRAIN_ROOT"
RESPONSE="$(curl -q -fsS --max-time 15 "$BRAIN_URL/api/brain/okr/company-key-results")"
node --input-type=module - "$RESPONSE" <<'JS'
import assert from 'node:assert/strict';
import { COMPANY_METRIC_MODE, companyMetric } from './src/lib/company-kr-metrics.js';
const body = JSON.parse(process.argv[2]);
assert.equal(body.success, true);
assert.ok(Array.isArray(body.items));
if (body.items.length) {
  const seen = new Set();
  for (const item of body.items) {
    assert.match(item.source_page_id, /^[a-f\d-]{36}$/i, '公司来源必须为Notion页ID');
    assert.ok(!seen.has(item.source_page_id), '重复公司来源');
    seen.add(item.source_page_id);
    assert.match(item.source_goal_id, /^[a-f\d-]{36}$/i);
    assert.ok(typeof item.unit === 'string' && item.unit.trim());
    assert.match(item.formal_revision, /^[a-f\d]{64}$/i, '缺正式版本');
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
