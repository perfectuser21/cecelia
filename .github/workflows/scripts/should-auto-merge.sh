#!/usr/bin/env bash
# should-auto-merge.sh <head_branch> <pr_title> [pr_number]
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
# 归属判据（法源：决策 e8f6134f-4131-4145-a893-79eb098011d9；事故 PR #4755）：
#   ⚠️ 历史教训：曾用「PR 标题是否 feat(harness): 前缀」判断 harness-owned。标题是 LLM
#   自由撰写的字段——generator 修 bug 写 fix(...)、重构写 refactor(...)，凡前缀非
#   feat(harness): 的 harness PR 全部漏过闸。#4755（fix(orchestrator): ...）就这样被
#   通用 auto-merge 抢先合并，evaluate_verdict / judge_verdict 均为 NULL（裁判没跑）。
#
#   现改为向 Brain 求证：initiative_runs.pr_url / 分支归属由 kernel 自身写入，不经
#   agent 之手，是唯一非 LLM 撰写的权威来源。命中 → SKIP，交回 harness gate。
#
#   fail-closed 方向（不可搞反）：Brain 不可达 / 超时 / 5xx / 非法 JSON 时，一律按
#   「可能是 harness-owned」处理 → SKIP 并打印降级原因。理由：误拦一个 /dev PR 只需
#   人点一下合并；误放一个 harness PR 会架空裁判权（正是本缺陷造成的实际事故）。
#
# ⚠️ 未来维护者注意：
#   - 不要把归属判据改回 PR 标题 / 分支名形状——它们都由 LLM 生成，不可靠。
#   - 不要把 fail-closed 方向搞反（判定失败默认 MERGE）——那正是要修的洞。
#   - 手工 /dev 的 cp-* PR，Brain 明确回答「不属于任何 harness run」时照旧 MERGE，
#     误拦会卡死所有 /dev 流程（红线）。
set -euo pipefail

HEAD_BRANCH="${1:-}"
PR_TITLE="${2:-}"    # 保留入参兼容；不再作归属判据（LLM 自由撰写，不可靠）
PR_NUMBER="${3:-}"

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
# 允许测试注入 HTTP 客户端（默认真 curl）；测试用 stub 模拟 owned / not-owned / 各类故障。
BRAIN_CURL="${BRAIN_CURL:-curl}"

# 非 cp-* 分支不归通用 auto-merge 管（保留 stop hook 删除后的原有行为）。
if ! printf '%s' "$HEAD_BRANCH" | grep -qE '^cp-'; then
  echo "SKIP: 非 cp-* 分支（${HEAD_BRANCH}），不走通用 auto-merge"
  exit 0
fi

# URL-encode 分支名（分支名理论上只含 [A-Za-z0-9._/-]，仍保守编码 / 与空格）。
enc_branch="${HEAD_BRANCH//\//%2F}"

# 向 Brain 求证归属，输出 OWNED / NOT_OWNED / UNKNOWN；UNKNOWN 时把降级原因写 stderr。
brain_ownership() {
  local url resp code body owned
  url="${BRAIN_URL%/}/api/brain/harness/pr-ownership?branch=${enc_branch}"
  [ -n "$PR_NUMBER" ] && url="${url}&pr_number=${PR_NUMBER}"

  # -w '\n%{http_code}'：body 后附一行 HTTP 状态码。curl 失败（连不上/超时）→ 非零退出，
  # 被下面 `if !` 捕获判为 UNKNOWN。
  if ! resp="$("$BRAIN_CURL" -sS -m 10 -w $'\n%{http_code}' "$url" 2>/dev/null)"; then
    echo "REASON:Brain 不可达或超时（curl 非零退出），无法求证 PR 归属" >&2
    echo "UNKNOWN"; return 0
  fi

  code="$(printf '%s' "$resp" | tail -n1)"
  body="$(printf '%s' "$resp" | sed '$d')"

  if [ "$code" != "200" ]; then
    echo "REASON:Brain 返回 HTTP ${code}（非 200），无法求证 PR 归属" >&2
    echo "UNKNOWN"; return 0
  fi

  if ! printf '%s' "$body" | jq -e . >/dev/null 2>&1; then
    echo "REASON:Brain 返回非法 JSON，无法求证 PR 归属" >&2
    echo "UNKNOWN"; return 0
  fi

  owned="$(printf '%s' "$body" | jq -r 'if .owned == true then "true" elif .owned == false then "false" else "missing" end' 2>/dev/null)"
  case "$owned" in
    true)  echo "OWNED"; return 0 ;;
    false) echo "NOT_OWNED"; return 0 ;;
    *)
      echo "REASON:Brain JSON 缺 owned 布尔字段，无法求证 PR 归属" >&2
      echo "UNKNOWN"; return 0 ;;
  esac
}

reason_file="$(mktemp)"
trap 'rm -f "$reason_file"' EXIT
RESULT="$(brain_ownership 2>"$reason_file")"
REASON="$(sed -n 's/^REASON://p' "$reason_file")"

case "$RESULT" in
  OWNED)
    echo "SKIP: harness-owned PR（Brain 求证：分支 ${HEAD_BRANCH} 属于某条 harness run），跳过 CI 通用 auto-merge，交给 harness 自己的 evaluator+裁判 gate 处理 merge"
    exit 0
    ;;
  NOT_OWNED)
    # Brain 明确回答「不属于任何 harness run」→ 手工 /dev 的 cp-* PR 照旧走通用 auto-merge。
    echo "MERGE"
    exit 0
    ;;
  *)
    # fail-closed：无法求证归属，保守跳过，避免误放 harness PR 架空裁判。
    echo "SKIP: fail-closed — 无法向 Brain 求证 PR 归属（${REASON:-未知原因}），保守跳过 CI 通用 auto-merge，避免误放 harness PR 架空 evaluator+裁判 gate"
    exit 0
    ;;
esac
