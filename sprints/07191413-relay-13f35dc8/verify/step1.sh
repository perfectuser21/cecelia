#!/usr/bin/env bash
# 单一事实源：Golden Path Step 1 验证命令。
# contract-draft.md Step 1「验证命令」与 contract-dod.md 对应 [BEHAVIOR] 条目
# 均只引用本文件（`bash sprints/07191413-relay-13f35dc8/verify/step1.sh`），
# 不再各自逐字粘贴一份——避免 GAN Round 1 内部一致性问题（两处分叉不被察觉）。
# 需从 repo root 执行（相对路径 scripts/relay-demo/slugify.mjs）。
OUT="$(node scripts/relay-demo/slugify.mjs "Test")"
STATUS=$?
[ "$STATUS" -eq 0 ]
test "$OUT" = "test"
