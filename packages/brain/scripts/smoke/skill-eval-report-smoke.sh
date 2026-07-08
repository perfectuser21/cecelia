#!/usr/bin/env bash
# 折自 render.mjs 的 n8n 连线图渲染器（Track 2，2026-07-08）上线后，
# 断言列表随之更新：新渲染器不再画老版"解剖图"（事实边界/高风险转人工/stage/escalate
# 这些字段是老图专属的 kernel.rules 展示方式，新版走 anatomy.pipeline/kernel.steps
# 统一 load/judge/gate 序列，对这份历史 legacy fixture 走 kernel.rules→无 kernel.steps
# 的空 judges 回退分支，是已知且被 review 接受的行为，见
# skill-eval-report-render.js Task 3 commit 说明）。
set -euo pipefail
cd "$(dirname "$0")/../.."   # packages/brain
node --input-type=module -e '
import { renderReportHtml } from "./src/skill-eval-report-render.js";
import fixture from "./src/__fixtures__/daily-report-cs.report.json" with { type: "json" };
const html = renderReportHtml(fixture);
const must = ["输入","内核","输出","stroke-dasharray","daily-report-cs","改了能用","状态包","回复正文","判断标签"];
const miss = must.filter(m => !html.includes(m));
if (miss.length) { console.error("smoke FAIL, 缺:", miss); process.exit(1); }
if (html.includes("报告数据不完整")) { console.error("smoke FAIL: 落入 fallback"); process.exit(1); }
console.log("skill-eval-report-smoke PASS");
'
