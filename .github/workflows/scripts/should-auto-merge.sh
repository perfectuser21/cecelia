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
# Phase 0 判据：所有 cp-* PR 都跳过这个历史通用 auto-merge 通道。标题、分支和 PR body
#   都是 PR 作者可变的 metadata，不能充当 evaluator/judge/human 的 merge authorization。
#   后续只有统一 Kernel controller 签发、绑定 exact head SHA 的授权 receipt 才能恢复自动
#   merge；在 receipt 尚未接入 GitHub workflow 前必须 fail-closed。
#
# ⚠️ 未来维护者注意：
#   - 不要重新使用 title prefix / branch regex / PR body 作为 merge authority。
#   - 自动合并恢复前，必须先有 SHA-bound、server-owned、single-use authorization receipt，
#     并由独立测试证明 evaluator、judge 和所需人审缺一不可。
set -euo pipefail

HEAD_BRANCH="${1:-}"
PR_TITLE="${2:-}"

# 非 cp-* 分支不归通用 auto-merge 管（保留 stop hook 删除后的原有行为）。
if ! printf '%s' "$HEAD_BRANCH" | grep -qE '^cp-'; then
  echo "SKIP: 非 cp-* 分支（${HEAD_BRANCH}），不走通用 auto-merge"
  exit 0
fi

# PR_TITLE 暂保留为兼容参数，但绝不参与授权判断。
: "$PR_TITLE"
echo "SKIP: cp-* PR 缺少 Kernel 签发的 SHA-bound merge authorization receipt"
