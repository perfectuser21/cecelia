#!/usr/bin/env node
/**
 * contract-gate-check.mjs — Contract Gate CLI（确定性合同预检，零 LLM）。
 *
 * 用法：node packages/brain/scripts/contract-gate-check.mjs <fixture_dir>
 *
 * 退出码：
 *   0  — 通过（无未豁免命中 / 工具齐备 / 有可验断言）
 *   1  — 不合格（命中作弊/弱 oracle/域规则，或 env_missing，或无可验断言）
 *   2  — fail-closed（目录/合同不可读，或缺参数）——绝不 exit 0 放行
 *
 * 单一来源：规则逻辑全在 ../src/lib/contract-gate.js，本 CLI 只做 I/O + 退出码。
 */

import path from 'node:path';
import { runContractGate, formatGateReport } from '../src/lib/contract-gate.js';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: node contract-gate-check.mjs <fixture_dir>');
  process.exit(2);
}

let result;
try {
  result = await runContractGate(dir, {});
} catch (err) {
  // fail-closed：不可读/不存在 → 非零退出，禁止 exit 0 放行
  console.error(`env_error: Contract Gate 无法读取 ${dir}: ${err.message}`);
  process.exit(2);
}

const fileLabel = path.join(dir, path.basename(result.contractFile || 'contract-dod.md'));
const report = formatGateReport(result, fileLabel);
if (report) console.log(report);

if (result.ok) {
  const verified = (result.hits || []).filter((h) => !h.exempted).length === 0;
  console.log(
    `✅ PASS — Contract Gate 通过清单：无未豁免命中(${verified ? 'ok' : '?'}) / 工具齐备 / 有可验断言`
  );
  process.exit(0);
}

const unexempted = (result.hits || []).filter((h) => !h.exempted).length;
console.error(
  `❌ Contract Gate FAIL — 未豁免命中 ${unexempted} 条 / env_missing ${(result.envMissing || []).length} 条（见上方清单）`
);
process.exit(1);
