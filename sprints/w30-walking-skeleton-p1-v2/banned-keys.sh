#!/bin/bash
# Stable IDs — W30 `/decrement` PR-G 死规则继承字段名 SSOT
# 单源定义；本文件是禁用字段名的**唯一文本源**（authoritative source of truth）。
# 所有验证脚本（contract-draft.md Step 8/9/E2E、contract-dod-ws1.md BEHAVIOR-11/12）
# 必须 `source` 本文件并引用 ${BANNED_RESPONSE_KEYS[@]} / ${BANNED_ERROR_KEYS[@]}，
# 不许直接粘贴字段名列表（粘贴 = 内部一致性违约 = SSOT drift 风险）。
#
# 修改禁用清单 = 改本文件一处即可，所有验证脚本自动同步。

# 34 个禁用响应字段名（PR-G 死规则；逐项字面照搬 sprint-prd.md L103-L105）
# 修订说明：round 1 contract Step 8 漏了 PRD L104 的 `response` 与 `out` 两名，
# 本 SSOT 文件按 PRD 字面补齐到 34（15 首要 + 10 泛 generic + 9 endpoint 复用）。
BANNED_RESPONSE_KEYS=(
  # 首要禁用（15，PRD L103）
  decremented predecessor prev previous
  n_minus_one minus_one pred dec decr decrementation
  subtraction lower lowered before earlier
  # 泛 generic 禁用（10，PRD L104）
  value input output data payload response answer out meta original
  # 复用其他 endpoint 字段名禁用（9，PRD L105）
  sum product quotient power remainder factorial
  negation incremented increment
)

# 10 个禁用错误响应字段名（错误体只许 `error` 一个字段）
BANNED_ERROR_KEYS=(
  result operation
  message msg reason
  detail details description info code
)
