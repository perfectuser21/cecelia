#!/usr/bin/env bash
# 案卷式 GAN 数据层（PR-A）结构 smoke：
# 守住五个接线点——migration 383 / store 导出 / callback 落库 / schema 顶层字段 / bundle 硬闸。
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

echo "[gan-case-file-smoke] 1. migration 383 存在且含 append-only 唯一键"
node -e "
const s = require('fs').readFileSync('migrations/383_gan_case_file.sql','utf8');
if (!/CREATE TABLE.*gan_case_file/s.test(s)) process.exit(1);
if (!/UNIQUE\s*\(\s*run_id\s*,\s*round\s*,\s*author_role\s*\)/.test(s)) process.exit(1);
"
echo "migration 383 结构正确 ✓"

echo "[gan-case-file-smoke] 2. case-file-store 导出 insert/load"
node -e "
const s = require('fs').readFileSync('src/orchestrator/case-file-store.js','utf8');
for (const fn of ['insertCaseFileRow','loadCaseFile']) {
  if (!new RegExp('export (async )?function ' + fn).test(s)) { console.error('缺导出: '+fn); process.exit(1); }
}
"
echo "store 导出齐全 ✓"

echo "[gan-case-file-smoke] 3. callback 终态同事务落案卷（终态白名单）"
node -e "
const s = require('fs').readFileSync('src/orchestrator/attempt-store.js','utf8');
if (!s.includes('insertCaseFileRow')) process.exit(1);
if (!s.includes('ADVERSARIAL_TERMINAL_STATUSES')) process.exit(1);
"
echo "callback 落库接线正确 ✓"

echo "[gan-case-file-smoke] 4. result schema 顶层显式收 case_file（zod strip 防线）"
node -e "
const s = require('fs').readFileSync('src/orchestrator/execution-contract.js','utf8');
if (!/case_file\s*:/.test(s)) process.exit(1);
if (!/rubric_scores/.test(s)) process.exit(1);
"
echo "schema 字段在位 ✓"

echo "[gan-case-file-smoke] 5. bundle 注入 + 256KB 硬闸常量"
node -e "
const d = require('fs').readFileSync('src/orchestrator/dispatcher.js','utf8');
const c = require('fs').readFileSync('src/orchestrator/constants.js','utf8');
if (!d.includes('case_file')) process.exit(1);
if (!/HARNESS_BUNDLE_MAX_BYTES/.test(c) || !/CASE_FILE_TEXT_MAX_BYTES/.test(c)) process.exit(1);
"
echo "bundle 注入与硬闸在位 ✓"

echo "[gan-case-file-smoke] 全部检查通过 ✓"
