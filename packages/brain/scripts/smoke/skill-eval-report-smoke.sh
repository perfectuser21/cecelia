#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."   # packages/brain
node --input-type=module -e '
import { renderReportHtml } from "./src/skill-eval-report-render.js";
import fixture from "./src/__fixtures__/daily-report-cs.report.json" with { type: "json" };
const html = renderReportHtml(fixture);
const must = ["输入","内核","输出","stroke-dasharray","事实边界","高风险转人工","stage","escalate","部分通过"];
const miss = must.filter(m => !html.includes(m));
if (miss.length) { console.error("smoke FAIL, 缺:", miss); process.exit(1); }
console.log("skill-eval-report-smoke PASS");
'
