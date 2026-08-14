#!/usr/bin/env bash
# should-auto-merge.sh <head_branch> <pr_title> [repo] [pr_number] [head_sha]
#
# 判定「CI 通用 auto-merge 通道」是否应该合并这个 PR，输出 MERGE 或 SKIP:<原因>。
#
# 为什么需要这个判据（双通道竞态历史根因，别当多余代码删掉）：
#   系统里有两条独立的 PR 合并通道，互不知晓：
#     通道1（快，本文件所在的 ci.yml auto-merge job）：只要「cp-* 分支 + CI 绿」就
#            gh pr merge --squash，完全不看 harness 的验收结论。
#     通道2（慢，harness 自己的 pre-merge gate）：evaluator agent 在分支上真跑一遍验收，
#            再由独立的 DeepSeek 模型（harness-judge）复核，只有裁判也 PASS 才由 harness
#            的 merge handler 真正 merge。
#   通道1 几乎总是比「真跑 E2E + LLM 裁判复核」的通道2 快，抢先合并，把裁判的裁决权
#   架空——用户曾亲眼见到「裁判说不放行，代码还是被 merge 了」。
#
# 事故根因（PR #4870）：旧判据只识别精确 `feat(harness):` 标题，其余 cp-*（含手动 /dev 的
#   fix(harness):/fix(brain): 等）无条件落入通用 MERGE，把 harness 的 evaluator+裁判 gate
#   架空。本刀改为 entitlement 驱动 + fail-closed 身份闸：
#     - 非 cp-* 分支 → SKIP（不归通用通道管）
#     - feat(harness): → SKIP（harness-owned，交自己的 evaluator+裁判 gate）
#     - 其余 cp-*：必须向 Brain 查受信通道签发、且精确绑定 repo+PR+head_sha 的 entitlement，
#       只有 entitled:true + trusted:true + 三元组逐字相等才 MERGE；
#       缺绑定参数 / entitled:false / trusted:false / 陈旧 head_sha / repo|pr 不符 /
#       Brain 不可达 → 一律 SKIP（fail-closed，绝不 fail-open 放行 merge）。
#
# ⚠️ 未来维护者注意：
#   - 不要把 fail-closed 判据当「多余代码」删掉——删了会让裁判 gate 再次被架空（#4870）。
#   - label / PR 标题（外部可写）不得单独授权 merge，授权只认受信 entitlement。
set -uo pipefail

HEAD_BRANCH="${1:-}"
PR_TITLE="${2:-}"
REPO="${3:-}"
PR_NUMBER="${4:-}"
HEAD_SHA="${5:-}"

# 非 cp-* 分支不归通用 auto-merge 管（保留 stop hook 删除后的原有行为）。
if ! printf '%s' "$HEAD_BRANCH" | grep -qE '^cp-'; then
  echo "SKIP: 非 cp-* 分支（${HEAD_BRANCH}），不走通用 auto-merge"
  exit 0
fi

# harness-owned PR：交给 harness 自己的 evaluator+DeepSeek 裁判 gate 决定 merge。
if printf '%s' "$PR_TITLE" | grep -qE '^feat\(harness\):'; then
  echo "SKIP: harness-owned PR（标题匹配 feat(harness): 前缀），交给 harness 自己的 evaluator+裁判 gate 处理 merge"
  exit 0
fi

# entitlement 核验必须三元组齐备（repo + pr_number + head_sha）。缺任一 → 无法核验 →
# fail-closed（符合安全语义；ci.yml 调用点须补全这三个绑定参数，否则所有 /dev auto-merge 被拦停）。
if [ -z "$REPO" ] || [ -z "$PR_NUMBER" ] || [ -z "$HEAD_SHA" ]; then
  echo "SKIP: entitlement_unverifiable（缺 repo/pr_number/head_sha 绑定参数，无法核验合并 entitlement）"
  exit 0
fi

BRAIN_BASE="${BRAIN_BASE_URL:-http://localhost:5221}"
TIMEOUT="${BRAIN_TIMEOUT:-5}"
URL="${BRAIN_BASE}/api/brain/harness/merge-entitlement?repo=${REPO}&pr=${PR_NUMBER}&head_sha=${HEAD_SHA}"

# curl 非 0 退出（超时/连接失败/HTTP 错误，-f 使 4xx/5xx 也非 0）→ 视为 Brain 不可达 →
# fail-closed，不解析 body。不设 set -e，手动读退出码。
RESP="$(curl -fsS -m "$TIMEOUT" "$URL")"
CURL_RC=$?
if [ "$CURL_RC" -ne 0 ]; then
  echo "SKIP: brain_unreachable（entitlement 查询失败 rc=${CURL_RC}，fail-closed 不放行）"
  exit 0
fi

# 轻量 JSON 字段提取（不依赖 jq；只读受信端点回体，字段固定）。
json_bool() { printf '%s' "$1" | grep -oiE "\"$2\"[[:space:]]*:[[:space:]]*(true|false)" | grep -oiE '(true|false)$' | head -1 | tr 'A-Z' 'a-z'; }
json_str()  { printf '%s' "$1" | sed -nE "s/.*\"$2\"[[:space:]]*:[[:space:]]*\"([^\"]*)\".*/\1/p" | head -1; }
json_num()  { printf '%s' "$1" | grep -oE "\"$2\"[[:space:]]*:[[:space:]]*[0-9]+" | grep -oE '[0-9]+$' | head -1; }

ENTITLED="$(json_bool "$RESP" entitled)"
TRUSTED="$(json_bool "$RESP" trusted)"
E_REPO="$(json_str "$RESP" repo)"
E_PR="$(json_num "$RESP" pr_number)"
E_SHA="$(json_str "$RESP" head_sha)"

if [ "$ENTITLED" != "true" ]; then
  echo "SKIP: entitlement_missing（受信通道未为此 (repo,pr,head_sha) 签发 entitlement，fail-closed）"
  exit 0
fi
if [ "$TRUSTED" != "true" ]; then
  echo "SKIP: untrusted_entitlement（签发通道不受信；label/标题不单独授权 merge）"
  exit 0
fi
if [ "$E_REPO" != "$REPO" ] || [ "$E_PR" != "$PR_NUMBER" ]; then
  echo "SKIP: entitlement_binding_mismatch（entitlement 绑定 repo/pr 与本 PR 不符）"
  exit 0
fi
if [ "$E_SHA" != "$HEAD_SHA" ]; then
  echo "SKIP: stale_head_sha（entitlement 绑定 head_sha 与当前 PR head 不符，force-push 后陈旧）"
  exit 0
fi

echo "MERGE"
