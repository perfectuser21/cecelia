#!/bin/bash
# e2e-verify.sh — evaluator 固化（Slice3 回归套件，merge 后可永久重跑）
# 来源：contract-draft.md ## E2E 验收 原文；Step 5 按 r3 勘误 A3（commit 8403a6c78，GAN 双方批准）
# 使用 import/require 语句级断言——原子串 grep 撞 main 预存 v2.2.0 HTTP 探针路由字符串
# （routes/walking-skeleton.js /api/brain/relay-smoke 路由名，非本模块 import），oracle 天生不可 PASS，属起草缺陷。
# 真红能力保留：任何生产文件 import 本模块仍必 FAIL。
set -euo pipefail

# final-e2e — local_api：headed relay 冒烟纯函数全 Golden Path
cd "$(git rev-parse --show-toplevel)"

# Step 1+2: 直调真实模块，断言确定性冒烟戳（含两次调用一致）
OUT=$(node -e "import(process.argv[1]).then(m=>{const d=new Date(process.argv[3]);const a=m.formatSmokeStamp(process.argv[2],d);const b=m.formatSmokeStamp(process.argv[2],d);if(a!==b)process.exit(1);console.log(a);})" ./packages/brain/src/utils/relay-smoke.js 097e589d-ec53-4102-b8d1-9aa582b88ebd 2026-07-22T00:00:00Z)
[ "$OUT" = "smoke:097e589d:20260722" ] || { echo "FAIL: 冒烟戳不符 got=$OUT"; exit 1; }
echo "PASS step1+2: $OUT"

# Step 3: 边界与错误路径（4 类非法输入 TypeError + 短 taskId 用全量）
OUT3=$(node -e "import(process.argv[1]).then(m=>{const d=new Date(process.argv[2]);const must=f=>{try{f();process.exit(1)}catch(e){if(!(e instanceof TypeError))process.exit(1)}};must(()=>m.formatSmokeStamp(String(),d));must(()=>m.formatSmokeStamp(12345678,d));must(()=>m.formatSmokeStamp(process.argv[3],new Date(NaN)));must(()=>m.formatSmokeStamp(process.argv[3],123));console.log(m.formatSmokeStamp(process.argv[4],d));})" ./packages/brain/src/utils/relay-smoke.js 2026-07-22T00:00:00Z 097e589d-ec53-4102-b8d1-9aa582b88ebd abc)
[ "$OUT3" = "smoke:abc:20260722" ] || { echo "FAIL: 边界路径 got=$OUT3"; exit 1; }
echo "PASS step3: TypeError x4 + short-taskId"

# Step 4: CI 常跑单测实跑全绿（文件必须在 brain vitest include 路径 src/utils/ 下）
[ -f packages/brain/src/utils/relay-smoke.test.js ] || { echo "FAIL: CI 常跑测试副本不存在"; exit 1; }
bash -lc "cd packages/brain && npx vitest run src/utils/relay-smoke.test.js --reporter=basic" || { echo "FAIL: brain 单测未通过"; exit 1; }
echo "PASS step4: brain-ci 常跑单测全绿"

# Step 5: 零生产接线负向验证（source-code inspection）
W=$(grep -rlE "(from|import)[[:space:]]+[^[:space:]]*relay-smoke|(require|import)\([^[:space:]]*relay-smoke" packages/brain/src --include="*.js" | grep -vE "^packages/brain/src/utils/relay-smoke(\.test)?\.js$" || true)
[ -z "$W" ] || { echo "FAIL: 发现生产接线 $W"; exit 1; }
echo "PASS step5: 零生产接线"

echo "✅ Golden Path 验证通过"
