#!/usr/bin/env bash
# should-auto-merge.sh <head_branch> <pr_number>
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
#   harness generator 产出的 PR 也用 cp-* 分支命名，会触发同一个 ci.yml。通道1 几乎总是
#   比「真跑 E2E + LLM 裁判复核」的通道2 快，抢先合并，把裁判的裁决权架空——用户曾亲眼
#   见到「裁判说不放行，代码还是被 merge 了」。
#
# 判据（决策 e8f6134f / 事故 PR #4755）：
#   ❌ 旧判据用 PR 标题前缀 feat(harness): 识别 harness-owned PR。但标题是 LLM 自由撰写
#      字段——generator 按 conventional commit 规范按改动类型选前缀（修 bug 写 fix(...)，
#      重构写 refactor(...)），标题写成 `fix(orchestrator): ...` 的 harness 产出（#4755）
#      不匹配前缀，被通用通道抢先合并，evaluate_verdict / judge_verdict 均为 NULL。
#   ✅ 新判据向 Brain 只读端点 /api/brain/harness/pr-ownership 求证——PR 归属由 kernel
#      自身写入 initiative_runs.pr_url / harness_attempts.task_bundle，不经 agent 之手，
#      是唯一非 LLM 撰写的权威来源。命中 harness run → SKIP（交裁判 gate）。
#
# ⚠️ fail-closed 红线（方向不可反）：Brain 不可达 / 超时 / 5xx / 非法 JSON 时，一律按
#   「可能是 harness-owned」处理 → SKIP 通用 auto-merge。理由：误拦一个 /dev PR 只需人点
#   一下合并；误放一个 harness PR 会架空裁判权，而后者正是本缺陷造成的实际事故。禁止在
#   判定失败时默认 MERGE。
#
# ⚠️ 未来维护者注意：
#   - 不要退回「用 PR 标题/分支名形状判断归属」——它们都由 LLM 撰写，同一可靠性等级，
#     标题判据的洞就是这么被 #4755 击穿的。
#   - 不要把 fail-closed 方向改成「判定失败默认 MERGE」——那会让本缺陷卷土重来。
#   - 不要把跳过逻辑错误地套到手动 /dev 的 cp-* PR 上——Brain 明确回答「不属于任何
#     harness run」时它们就该被通用 auto-merge 正常合并，误拦会卡死所有 /dev 流程。
set -euo pipefail

HEAD_BRANCH="${1:-}"
PR_NUMBER="${2:-}"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
QUERY_TIMEOUT="${AUTO_MERGE_BRAIN_TIMEOUT:-10}"

# 非 cp-* 分支不归通用 auto-merge 管（保留原有行为），也无需打扰 Brain。
if ! printf '%s' "$HEAD_BRANCH" | grep -qE '^cp-'; then
  echo "SKIP: 非 cp-* 分支（${HEAD_BRANCH}），不走通用 auto-merge"
  exit 0
fi

# fail-closed：任何求证失败都保守 SKIP，并在 job 日志显式打印降级原因便于排查。
skip_degraded() {
  echo "[should-auto-merge][degraded] $1" >&2
  echo "SKIP: Brain 归属求证失败（$1）→ fail-closed 保守跳过通用 auto-merge，交 harness 裁判 gate 兜底"
  exit 0
}

ENDPOINT="${BRAIN_URL%/}/api/brain/harness/pr-ownership"
TMP_BODY="$(mktemp)"
trap 'rm -f "$TMP_BODY"' EXIT

set +e
HTTP_CODE="$(curl -sS -m "$QUERY_TIMEOUT" -o "$TMP_BODY" -w '%{http_code}' \
  --get "$ENDPOINT" \
  --data-urlencode "branch=${HEAD_BRANCH}" \
  --data-urlencode "pr=${PR_NUMBER}" 2>/dev/null)"
CURL_RC=$?
set -e

if [ "$CURL_RC" -ne 0 ]; then
  skip_degraded "Brain 不可达/超时（curl rc=${CURL_RC}, url=${ENDPOINT}, timeout=${QUERY_TIMEOUT}s）"
fi
if ! printf '%s' "$HTTP_CODE" | grep -qE '^2[0-9][0-9]$'; then
  skip_degraded "Brain 返回非 2xx（HTTP ${HTTP_CODE}）"
fi

set +e
OWNED="$(jq -r '.harness_owned' "$TMP_BODY" 2>/dev/null)"
JQ_RC=$?
set -e
if [ "$JQ_RC" -ne 0 ]; then
  skip_degraded "Brain 返回非法 JSON（jq 无法解析）"
fi

case "$OWNED" in
  true)
    echo "SKIP: harness-owned PR（Brain 求证命中 harness run），跳过 CI 通用 auto-merge，交给 harness 自己的 evaluator+裁判 gate 处理 merge"
    exit 0
    ;;
  false)
    echo "MERGE"
    exit 0
    ;;
  *)
    skip_degraded "Brain 返回 harness_owned 非布尔（值=${OWNED}）"
    ;;
esac
