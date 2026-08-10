#!/usr/bin/env bash
# should-auto-merge.sh <head_branch> <pr_title>
#
# 判定「CI 通用 auto-merge 通道」是否应该合并这个 PR，输出 MERGE 或 SKIP:<原因>。
#
# 为什么需要这个判据（三通道竞态历史根因，别当多余代码删掉）：
#   系统里有三条互不知晓的 PR 合并通道：
#     通道1（快，本文件所在的 ci.yml auto-merge job）：CI 绿即 gh pr merge --auto，
#            不看 harness 的验收结论。
#     通道2（慢，harness kernel mergeGate）：evaluate PASS + judge PASS + verdict SHA==head
#            + 人审，才由 kernel 真正 merge——唯一正确通道。
#     通道3（engine-pr-watchdog，源在 zenithjoy-skills）：对任何 CI 转绿的 PR 起 --auto。
#   harness generator 产出的 PR 也用 cp-* 分支命名，会触发通道1/通道3，抢先合并、架空
#   裁判裁决权——2026-08-10 #4755（无裁决被合）/#4759（judge FAIL 仍被合）两起实证。
#
# 判据（v2，收归单一裁决闸）：**不再用 PR 标题**（标题是 LLM 自由撰写字段，#4755 已证漏判：
#   非 feat(harness): 的 harness 产出全部漏过）。改为向 Brain 归属端点求证——归属只凭
#   kernel 写入的 `initiative_runs.pr_url`/`pr_branch`（非标题/分支正则）。
#     - Brain 返回 owned=true（harness-owned）→ SKIP，把 merge 交还 harness kernel gate。
#     - Brain 返回 owned=false（非 harness 的手动 /dev PR）+ cp-* → MERGE（不回归 /dev）。
#     - Brain 不可达/超时/5xx/非法 JSON（任意异常）→ **fail-closed = SKIP**，绝不 MERGE
#       （宁可暂缓 /dev，绝不放行未裁决的 harness PR）。
#
# 兜底：即使本脚本或通道3 误启 --auto，harness-owned PR 上的 `harness-judge` required
#   check 默认非 success，GitHub 会排队不合并——kernel mergeGate 全过后才置 success。
#
# ⚠️ 未来维护者注意：
#   - 不要把归属求证/ fail-closed 当「多余代码」删掉——删了会让裁判 gate 再次被架空。
#   - 不要退回「按标题判」——那正是 #4755 的根因。
#   - 不要把 SKIP 逻辑误套到 owned=false 的手动 /dev PR 上——那些该被通用 auto-merge 合并，
#     误拦会卡死所有 /dev 流程（红线）。
set -euo pipefail

HEAD_BRANCH="${1:-}"
PR_TITLE="${2:-}"          # 仅日志，不再作合并判据（v2 语义迁移：title → Brain owned）
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
BRAIN_TIMEOUT="${BRAIN_TIMEOUT:-8}"   # 有限超时（秒）：防 Brain 挂起时 auto-merge job 无限死等 CI

# 非 cp-* 分支不归通用 auto-merge 管（保留原有行为）。
if ! printf '%s' "$HEAD_BRANCH" | grep -qE '^cp-'; then
  echo "SKIP: 非 cp-* 分支（${HEAD_BRANCH}），不走通用 auto-merge"
  exit 0
fi

# 向 Brain 求证归属（凭 initiative_runs.pr_url/pr_branch，非标题）。
# curl 显式带 --max-time：Brain 接受连接后挂起时逼出 exit28（区别于连接被拒 exit7），
# 两种失败都落到下方 fail-closed 分支输出 SKIP。-w 追加 HTTP 状态码到末行。
RESP="$(curl -sS --max-time "$BRAIN_TIMEOUT" -w $'\n%{http_code}' \
  "${BRAIN_URL}/api/brain/harness/pr-ownership?branch=${HEAD_BRANCH}" 2>/dev/null)" || {
  echo "SKIP: Brain 归属求证失败（不可达/超时，curl 非零退出），fail-closed 按 harness-owned 处理（title=${PR_TITLE}）"
  exit 0
}

HTTP_CODE="$(printf '%s' "$RESP" | tail -n1)"
BODY="$(printf '%s' "$RESP" | sed '$d')"

# 非 2xx（含 5xx）→ fail-closed SKIP。
if ! printf '%s' "$HTTP_CODE" | grep -qE '^2[0-9][0-9]$'; then
  echo "SKIP: Brain 归属端点返回非 2xx（${HTTP_CODE}），fail-closed 按 harness-owned 处理"
  exit 0
fi

# 解析 owned；非法 JSON / 缺字段 / null → fail-closed SKIP。
OWNED="$(printf '%s' "$BODY" | jq -r 'if (.owned|type)=="boolean" then (.owned|tostring) else "__invalid__" end' 2>/dev/null)" || OWNED="__invalid__"

if [ "$OWNED" = "true" ]; then
  echo "SKIP: harness-owned PR（Brain 求证 owned=true，凭 initiative_runs 记录），交 harness kernel evaluator+裁判 gate 决定 merge"
  exit 0
fi

if [ "$OWNED" = "false" ]; then
  echo "MERGE"
  exit 0
fi

# owned 非布尔（非法 JSON / 缺字段 / null）→ fail-closed。
echo "SKIP: Brain 归属响应无法确定 owned（body 非法或缺字段），fail-closed 按 harness-owned 处理"
exit 0
