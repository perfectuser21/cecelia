#!/usr/bin/env bash
# skill-eval-report-smoke.sh — 验收报告渲染器 smoke（6维度新格式）
# Sprint: skill-eval-full-4page
# fixture 已升级为 6维度 schema（dimensions.functional_map/.dependency_audit/...）
# 新渲染器以结构化表格替代老版 SVG 圆核图
set -euo pipefail
cd "$(dirname "$0")/../.."   # packages/brain
node --input-type=module -e '
import { renderReportHtml } from "./src/skill-eval-report-render.js";
import fixture from "./src/__fixtures__/daily-report-cs.report.json" with { type: "json" };
const html = renderReportHtml(fixture);
const must = ["功能地图","依赖审计","判定逻辑","输出可验证性","daily-report-cs","改了能用","状态包","回复正文","判断标签"];
const miss = must.filter(m => !html.includes(m));
if (miss.length) { console.error("smoke FAIL, 缺:", miss); process.exit(1); }
if (html.includes("报告数据不完整")) { console.error("smoke FAIL: 落入 fallback"); process.exit(1); }
console.log("skill-eval-report-smoke PASS");
'
