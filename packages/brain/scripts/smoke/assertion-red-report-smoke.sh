#!/usr/bin/env bash
# Smoke: assertion-red-report — 晨报/日报「业务断言红灯」行（链 bf5088a3 棒4 消费，任务 4ff8ad43，决策 702949b6）
# 验证（假 pool 跑真逻辑，不连库）：
#   1. 24h 内 business_probe_runner 的 FAIL 回执含 severity=error → 🔴 RED 行，点名 路径/步骤/探针×次数
#   2. 只有 warn → 🟡 AMBER；空集 → null（晨报不出行、日报空串）；查询抛错 → null 不抛
#   3. 日报板块含标题 + 汇总 + 每组一行
#   4. 接线：晨报 fetchAssertionRedLine 并列 bareRunLine；日报 readAssertionRedState + 板块九
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "[assertion-red-report-smoke] 1-3. 假 pool 跑真逻辑"
node --input-type=module -e "
import { readAssertionRedState, renderAssertionRedLine, renderAssertionRedSection, PROBE_EXECUTOR_KIND } from './src/lib/assertion-red-report.js';
const poolOf = (rows) => ({ query: async (sql, params) => {
  if (!/FROM journey_assertion_receipts/.test(sql) || params[0] !== PROBE_EXECUTOR_KIND || params[1] !== 24) { throw new Error('SQL/参数形状不对: ' + JSON.stringify(params)); }
  if (rows instanceof Error) throw rows;
  return { rows };
} });
const red = await readAssertionRedState(poolOf([
  { journey: '客户智能获客路径', step: 'Lead 表进人', assertion_ref: 'probe:videos_readback', fail_count: 3, has_error: true },
  { journey: '客户智能获客路径', step: 'Lead 表进人', assertion_ref: 'probe:line_key_not_null', fail_count: 1, has_error: false },
]));
const line = renderAssertionRedLine(red);
if (line !== '🔴 RED 断言红灯：客户智能获客路径/Lead 表进人 videos_readback×3, line_key_not_null×1（24h）') { console.error('FAIL RED 行文案: ' + line); process.exit(1); }
const section = renderAssertionRedSection(red);
if (!section.startsWith('== 业务断言红灯（24h）==\n🔴 RED 共 4 次 FAIL（含 error 级）') || !section.includes('· videos_readback ×3（error）')) { console.error('FAIL 日报板块: ' + section); process.exit(1); }
const amber = await readAssertionRedState(poolOf([{ journey: 'J', step: 'S', assertion_ref: 'probe:k', fail_count: 2, has_error: false }]));
if (amber.level !== 'AMBER' || !/^🟡 AMBER 断言红灯：J\/S k×2/.test(renderAssertionRedLine(amber))) { console.error('FAIL 只 warn 应 AMBER'); process.exit(1); }
if (await readAssertionRedState(poolOf([])) !== null || renderAssertionRedLine(null) !== null || renderAssertionRedSection(null) !== '') { console.error('FAIL 空集应 null/不出行'); process.exit(1); }
if (await readAssertionRedState(poolOf(new Error('relation does not exist'))) !== null) { console.error('FAIL 查询失败应 null'); process.exit(1); }
console.log('RED 行 / 日报板块 / AMBER / 空集 / 抛错降级 ✓');
"

echo "[assertion-red-report-smoke] 4. 接线"
node -e "
const fs = require('fs');
const checks = [
  ['src/morning-cockpit-bark.js', ['fetchAssertionRedLine(pool)', 'renderAssertionRedLine', 'if (assertionRedLine) lines.push(assertionRedLine)']],
  ['src/daily-report-generator.js', ['readAssertionRedState(dbPool)', 'renderAssertionRedSection(assertionRed)', 'export { renderAssertionRedSection }']],
];
let fail = false;
for (const [file, needles] of checks) {
  const src = fs.readFileSync(file, 'utf8');
  for (const n of needles) if (!src.includes(n)) { console.error('FAIL ' + file + ' 缺少: ' + n); fail = true; }
}
if (fail) process.exit(1);
console.log('晨报 / 日报 接线 ✓');
"

echo "[assertion-red-report-smoke] PASS"
