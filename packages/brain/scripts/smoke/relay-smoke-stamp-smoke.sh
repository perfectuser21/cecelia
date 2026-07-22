#!/bin/bash
# relay-smoke-stamp-smoke.sh — headed relay 链冒烟纯函数 formatSmokeStamp 冒烟
# 复用合同 E2E 验收脚本 Step 1+2 与 Step 3 断言，真跑真实 repo 模块。
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

# Step 1+2: 直调真实模块，断言确定性冒烟戳（含两次调用一致）
OUT=$(node -e "import(process.argv[1]).then(m=>{const d=new Date(process.argv[3]);const a=m.formatSmokeStamp(process.argv[2],d);const b=m.formatSmokeStamp(process.argv[2],d);if(a!==b)process.exit(1);console.log(a);})" ./packages/brain/src/utils/relay-smoke.js 097e589d-ec53-4102-b8d1-9aa582b88ebd 2026-07-22T00:00:00Z)
[ "$OUT" = "smoke:097e589d:20260722" ] || { echo "FAIL: 冒烟戳不符 got=$OUT"; exit 1; }
echo "PASS step1+2: $OUT"

# Step 3: 边界与错误路径（4 类非法输入 TypeError + 短 taskId 用全量）
OUT3=$(node -e "import(process.argv[1]).then(m=>{const d=new Date(process.argv[2]);const must=f=>{try{f();process.exit(1)}catch(e){if(!(e instanceof TypeError))process.exit(1)}};must(()=>m.formatSmokeStamp(String(),d));must(()=>m.formatSmokeStamp(12345678,d));must(()=>m.formatSmokeStamp(process.argv[3],new Date(NaN)));must(()=>m.formatSmokeStamp(process.argv[3],123));console.log(m.formatSmokeStamp(process.argv[4],d));})" ./packages/brain/src/utils/relay-smoke.js 2026-07-22T00:00:00Z 097e589d-ec53-4102-b8d1-9aa582b88ebd abc)
[ "$OUT3" = "smoke:abc:20260722" ] || { echo "FAIL: 边界路径 got=$OUT3"; exit 1; }
echo "PASS step3: TypeError x4 + short-taskId"

echo "✅ relay-smoke-stamp smoke 通过"
