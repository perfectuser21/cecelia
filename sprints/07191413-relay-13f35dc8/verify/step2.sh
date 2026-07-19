#!/usr/bin/env bash
# 单一事实源：Golden Path Step 2 验证命令（见 verify/step1.sh 顶部说明）。
# 需从 repo root 执行。
OUT="$(node scripts/relay-demo/slugify.mjs "")"
STATUS=$?
[ "$STATUS" -eq 0 ]
test "$OUT" = ""
