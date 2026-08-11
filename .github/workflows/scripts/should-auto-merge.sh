#!/usr/bin/env bash
# should-auto-merge.sh <head_branch> <pr_number>
#
# 判定「CI 通用 auto-merge 通道」是否应该合并这个 PR，输出 MERGE 或 SKIP:<原因>。
#
# 为什么需要这个判据（三通道竞态历史根因，别当多余代码删掉）：
#   系统里有三条互不知晓的 PR 合并通道：
#     通道1（快，本文件所在的 ci.yml auto-merge job）：只要「cp-* 分支 + CI 绿」就
#            gh pr merge --auto --squash。
#     通道2（慢，harness kernel mergeGate）：evaluate PASS + judge PASS + verdict SHA
#            锚定当前 head + 人审（如需）才由 kernel 真正 merge。唯一正确通道。
#     通道3（engine-pr-watchdog）：对任何 CI 转绿的 PR 起 gh pr merge --auto，不看裁决。
#   harness generator 产出的 PR 也用 cp-* 分支命名（cp-<时间>-<taskid>），会触发同一个
#   ci.yml。若此处按「cp-* + CI 绿」抢先合并，会架空 kernel 的 evaluator+裁判裁决权
#   （用户曾亲眼见「裁判说不放行，代码还是被 merge 了」——#4755/#4759 实证）。
#
# 判据（2026-08 收敛）：不再看 PR 标题（LLM 自由撰写，#4755 标题 fix(orchestrator): 漏过），
#   改向 Brain 求证归属——查 initiative_runs.pr_url（由 kernel/relay-watchdog 写入，非 LLM）
#   是否精确匹配本 PR 号。归属为 harness-owned → 跳过通用 auto-merge，把 merge 决定权完全
#   交还给 kernel 自己的 mergeGate（该 gate 满足后会把 harness-judge required check 置
#   success，三通道自然收敛到同一个闸）。
#
# fail-closed（红线）：向 Brain 求证若「curl 失败 / 超时 / 非 200 / 非法 JSON / owned 字段
#   缺失」，一律按 harness-owned 处理（输出 SKIP）。宁可卡住等 kernel，也绝不放一个可能
#   绕过 judge 的合并。误 SKIP 的手动 /dev PR 可人工合，误 MERGE 的 harness PR 不可逆。
#
# ⚠️ 未来维护者注意：
#   - 不要把归属判据退回「PR 标题」——标题是 LLM 自由字段，#4755 已实证漏过。
#   - 不要把 fail-closed 改成 fail-open（Brain 抖动瞬间就会恢复绕过 judge，红线破）。
#   - 不要把跳过逻辑套到手动 /dev 的 cp-* PR（Brain 明确 owned:false）上——那些 PR 就该
#     被通用 auto-merge 正常合并，误拦会卡死所有 /dev 流程（红线）。
set -euo pipefail

HEAD_BRANCH="${1:-}"
PR_NUMBER="${2:-}"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

# 非 cp-* 分支不归通用 auto-merge 管（保留 stop hook 删除后的原有行为）。
if ! printf '%s' "$HEAD_BRANCH" | grep -qE '^cp-'; then
  echo "SKIP: 非 cp-* 分支（${HEAD_BRANCH}），不走通用 auto-merge"
  exit 0
fi

# cp-* 分支：向 Brain 求证归属。curl -w 追加 '\n<http_code>'，输出 body\n<code>。
# --max-time 5：Brain 抖动/挂死时不 hang，超时即 fail-closed。
OWNERSHIP_URL="${BRAIN_URL%/}/api/brain/harness/pr-ownership?pr_number=${PR_NUMBER}"
if ! RESP="$(curl -s --max-time 5 -w $'\n%{http_code}' "$OWNERSHIP_URL" 2>/dev/null)"; then
  echo "SKIP:fail-closed(Brain 归属求证失败/超时 curl_exit，按 harness-owned 处理，交 kernel mergeGate) url=${OWNERSHIP_URL}"
  exit 0
fi

# HTTP code 是 curl -w 追加在最末尾的 3 位状态码。用「末尾 3 位数字」提取而非按行切，
# 因为分隔符可能是真实换行（真 curl / printf 'FORMAT'）也可能是字面 \n（printf '%s' 传参
# 的桩），两种都要能正确解析出 200/400/500，否则 not_owned 会被误判成非 200 → fail-closed。
HTTP_CODE="$(printf '%s' "$RESP" | grep -oE '[0-9]{3}' | tail -n1)"

if [ "$HTTP_CODE" != "200" ]; then
  echo "SKIP:fail-closed(Brain 归属端点非 200: ${HTTP_CODE:-none}，按 harness-owned 处理，交 kernel mergeGate)"
  exit 0
fi

# 从整个响应提取 owned 布尔（不依赖 jq，兼容单测环境；不按行切以兼容字面 \n 桩）；
# 提取不到 → 非法 JSON / 缺字段 → fail-closed。
OWNED="$(printf '%s' "$RESP" | grep -oE '"owned"[[:space:]]*:[[:space:]]*(true|false)' | grep -oE 'true|false' | head -n1 || true)"

if [ -z "$OWNED" ]; then
  echo "SKIP:fail-closed(Brain 归属响应缺 owned 字段/非法 JSON，按 harness-owned 处理，交 kernel mergeGate)"
  exit 0
fi

if [ "$OWNED" = "true" ]; then
  echo "SKIP: harness-owned PR（Brain 归属求证 owned:true，PR #${PR_NUMBER}），跳过 CI 通用 auto-merge，交给 kernel mergeGate（evaluate+judge）处理 merge"
  exit 0
fi

# owned:false —— Brain 明确「不属于任何 harness run」（真手动 /dev），照旧被通用 auto-merge 合并。
echo "MERGE"
