#!/usr/bin/env bash
# should-auto-merge.sh <head_branch> <pr_title>
#
# 判定「CI 通用 auto-merge 通道」是否应该合并这个 PR，输出 MERGE 或 SKIP:<原因>。
#
# 为什么需要这个判据（双通道竞态历史根因，别当多余代码删掉）：
#   系统里有两条独立的 PR 合并通道，互不知晓：
#     通道1（快，本文件所在的 ci.yml auto-merge job）：只要「cp-* 分支 + CI 绿」就
#            gh pr merge --squash，完全不看 harness 的验收结论。
#     通道2（慢，harness 自己的 pre-merge gate）：evaluator agent 在分支上真跑一遍验收，
#            再由独立的 DeepSeek 模型（harness-judge）复核，只有裁判也 PASS 才由 harness
#            的 reportNode 自合逻辑真正 merge。
#   harness generator 产出的 PR 也用 cp-* 分支命名（cp-<时间>-<taskid>），会触发同一个
#   ci.yml。通道1 几乎总是比「真跑 E2E + LLM 裁判复核」的通道2 快，抢先合并，把裁判的
#   裁决权架空——用户曾亲眼见到「裁判说不放行，代码还是被 merge 了」。
#
# 判据：用 PR 标题而非分支名区分（cp-* 两边都用，无法区分）。harness generator 的 PR
#   标题固定 `feat(harness): ...` 前缀（见 zenithjoy-skills/harness-generator/SKILL.md
#   的 gh pr create --title），是 generator 独有的可靠标记；手动 /dev 的 PR 走
#   fix(xxx):/feat(xxx): 等其它前缀，绝不会用 feat(harness):。命中该前缀 → 跳过通用
#   auto-merge，把 merge 决定权完全交还给 harness 自己的 evaluator+裁判 gate。
#
# ⚠️ 未来维护者注意：
#   - 不要删掉 feat(harness): 判断当「多余代码」——删了会让裁判 gate 再次被架空。
#   - 不要把这个跳过逻辑错误地套到手动 /dev 的 fix/feat PR 上——那些 PR 就该被通用
#     auto-merge 正常合并，误拦会让所有 /dev 流程卡住。
set -euo pipefail

HEAD_BRANCH="${1:-}"
PR_TITLE="${2:-}"

# 非 cp-* 分支不归通用 auto-merge 管（保留 stop hook 删除后的原有行为）。
if ! printf '%s' "$HEAD_BRANCH" | grep -qE '^cp-'; then
  echo "SKIP: 非 cp-* 分支（${HEAD_BRANCH}），不走通用 auto-merge"
  exit 0
fi

# harness-owned PR：交给 harness 自己的 evaluator+DeepSeek 裁判 gate 决定 merge。
if printf '%s' "$PR_TITLE" | grep -qE '^feat\(harness\):'; then
  echo "SKIP: harness-owned PR（标题匹配 feat(harness): 前缀），跳过 CI 通用 auto-merge，交给 harness 自己的 evaluator+裁判 gate 处理 merge"
  exit 0
fi

# Kernel Harness 2.0（kernel-v1）产出的 PR：分支固定 cp-route-api-*、标题固定
# 「Harness approved candidate <task>」，不带 feat(harness): 前缀。第 50 批（r84 #5095
# 案卷，2026-08-30）：此前被当普通 cp-* PR 抢先合并，kernel 的 merge gate 人审
# （capability-change-v1 强制人工盖章）根本没轮到。merge 由 kernel 的 merge_pr 在人审
# 通过后执行；分支前缀与标题任一命中即跳过。
if printf '%s' "$HEAD_BRANCH" | grep -qE '^cp-route-api-' \
  || printf '%s' "$PR_TITLE" | grep -qE '^Harness approved candidate'; then
  echo "SKIP: kernel-owned PR（cp-route-api-* 分支 / Harness approved candidate 标题），跳过 CI 通用 auto-merge，merge 归 kernel merge gate（人审后 merge_pr）"
  exit 0
fi

echo "MERGE"
