#!/bin/bash
set -e
# Smoke: harness-report.mjs 脚本化验证
# 验证 S2/S3/S4 文件生成 + reportNode script_path 注入 + PARTIAL_FAIL 行为

FIXTURE=$(mktemp -d)

cleanup() { rm -rf "${FIXTURE}"; }
trap cleanup EXIT

echo "# test prd" > "${FIXTURE}/sprint-prd.md"

# S2/S3/S4: 生成三文件（Brain API 不可达时 PARTIAL_FAIL exit 1，但文件仍生成 — 用 || true 放行）
BRAIN_URL=http://localhost:19999 node packages/brain/scripts/harness-report.mjs \
  --sprint-dir "${FIXTURE}" \
  --task-id "00000000-0000-0000-0000-000000000001" \
  --pr-url "https://github.com/test/smoke" \
  --feature-id "" 2>&1 || true

[ -f "${FIXTURE}/harness-report.md" ] || { echo "FAIL: harness-report.md 未生成"; exit 1; }
[ -f "${FIXTURE}/learning.md" ] || { echo "FAIL: learning.md 未生成"; exit 1; }
[ -f "${FIXTURE}/index.html" ] || { echo "FAIL: index.html 未生成"; exit 1; }

# script_path 注入：Slice3 后 harness_report 派发 SSOT 挪到 staging-promote.js
# （buildHarnessReportInsert），reportNode 仅在 FAIL 路径经 spawnHarnessReport 调它。
node -e "
const fs = require('fs');
const sp = fs.readFileSync('packages/brain/src/staging-promote.js', 'utf8');
if (!sp.includes('harness-report.mjs')) { console.error('FAIL: harness-report.mjs not in staging-promote buildHarnessReportInsert'); process.exit(1); }
const g = fs.readFileSync('packages/brain/src/workflows/harness-initiative.graph.js', 'utf8');
if (!g.includes('spawnHarnessReport')) { console.error('FAIL: reportNode 未经 spawnHarnessReport 派 report'); process.exit(1); }
console.log('OK: harness_report script_path SSOT 在 staging-promote.js，reportNode 失败路径经 spawnHarnessReport');
"

echo "✅ harness-report-mjs smoke: S2/S3/S4 文件生成 + reportNode script_path 验证通过"
