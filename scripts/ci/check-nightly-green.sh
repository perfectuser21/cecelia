#!/usr/bin/env bash
# 刀C Release Gate：查最近 nightly 绿色证据
#
# 查询 GitHub API，验证 nightly-regression.yml 在过去 WINDOW_HOURS 小时内
# 有至少一次成功完成的 run（conclusion=success）。
# 找到 → 打印证据（落章）并 exit 0
# 未找到 → 打印原因并 exit 1
#
# 用法：
#   GITHUB_TOKEN=<token> GITHUB_REPOSITORY=owner/repo bash check-nightly-green.sh
#   可选环境变量：WINDOW_HOURS（默认 48）、BYPASS_NIGHTLY_GATE（=1 跳过检查，紧急通道）
#
# 依赖：curl、jq、python3（date 计算回退）

set -euo pipefail

WORKFLOW_FILE="nightly-regression.yml"
WINDOW_HOURS="${WINDOW_HOURS:-48}"
REPO="${GITHUB_REPOSITORY:-}"
TOKEN="${GITHUB_TOKEN:-}"

# ── 前置校验 ──────────────────────────────────────────────────────────────────

if [ "${BYPASS_NIGHTLY_GATE:-}" = "1" ]; then
  echo "::warning::BYPASS_NIGHTLY_GATE=1 — Release Gate 已绕过（紧急通道），请确保知晓风险"
  exit 0
fi

if [ -z "$REPO" ]; then
  echo "::error::GITHUB_REPOSITORY 未设置"
  exit 1
fi

if [ -z "$TOKEN" ]; then
  echo "::error::GITHUB_TOKEN 未设置"
  exit 1
fi

# ── 查询最近 completed run ─────────────────────────────────────────────────────

echo "🔍 刀C Release Gate：查 ${WORKFLOW_FILE} 最近 ${WINDOW_HOURS}h 绿色记录…"
echo "   仓库: ${REPO}"

API_URL="https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW_FILE}/runs"
RESP=$(curl -sf \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "${API_URL}?branch=main&status=completed&per_page=5" \
  2>/dev/null) || {
  echo "::error::GitHub API 请求失败（网络或权限问题）"
  echo "  URL: ${API_URL}"
  exit 1
}

# ── 从 runs 中找最近一次 success ───────────────────────────────────────────────

LATEST_SUCCESS=$(echo "$RESP" | jq -r '
  .workflow_runs[]
  | select(.conclusion == "success")
  | {id, html_url, run_started_at, updated_at, head_sha}
  | @json
' 2>/dev/null | head -1)

if [ -z "$LATEST_SUCCESS" ]; then
  TOTAL=$(echo "$RESP" | jq -r '.total_count // 0')
  LATEST_CONCLUSION=$(echo "$RESP" | jq -r '.workflow_runs[0].conclusion // "none"')
  echo "::error::Release Gate 阻断 — ${WORKFLOW_FILE} 无最近 success 记录"
  echo "  总 runs: ${TOTAL}"
  echo "  最近 run 结论: ${LATEST_CONCLUSION}"
  echo ""
  echo "  解决方案："
  echo "  1. 等待今夜 nightly (UTC 19:00 / 北京 03:00) 自动运行"
  echo "  2. 手动触发: gh workflow run ${WORKFLOW_FILE} --ref main"
  echo "  3. 紧急绕过: BYPASS_NIGHTLY_GATE=1 (需在 workflow 输入中启用)"
  exit 1
fi

# ── 时间窗口校验 ───────────────────────────────────────────────────────────────

RUN_ID=$(echo "$LATEST_SUCCESS" | jq -r '.id')
RUN_URL=$(echo "$LATEST_SUCCESS" | jq -r '.html_url')
RUN_TIME=$(echo "$LATEST_SUCCESS" | jq -r '.updated_at')
RUN_SHA=$(echo "$LATEST_SUCCESS" | jq -r '.head_sha')
RUN_SHA_SHORT="${RUN_SHA:0:7}"

# 计算 run 距今小时数（python3 兜底 date 解析）
NOW_EPOCH=$(date -u +%s 2>/dev/null || python3 -c "import time; print(int(time.time()))")
RUN_EPOCH=$(python3 -c "
import datetime, sys
s = '${RUN_TIME}'
# 兼容 2026-07-10T03:00:00Z 与 2026-07-10T03:00:00+00:00
s = s.replace('Z','+00:00')
dt = datetime.datetime.fromisoformat(s)
print(int(dt.timestamp()))
" 2>/dev/null) || {
  echo "::warning::无法解析 run 时间 '${RUN_TIME}'，跳过时间窗口校验"
  RUN_EPOCH=0
}

HOURS_AGO=0
if [ "$RUN_EPOCH" -gt 0 ] 2>/dev/null; then
  SECONDS_AGO=$(( NOW_EPOCH - RUN_EPOCH ))
  HOURS_AGO=$(( SECONDS_AGO / 3600 ))
fi

if [ "$HOURS_AGO" -gt "$WINDOW_HOURS" ] && [ "$RUN_EPOCH" -gt 0 ]; then
  echo "::error::Release Gate 阻断 — 最近 success run 距今 ${HOURS_AGO}h，超出 ${WINDOW_HOURS}h 窗口"
  echo "  Run #${RUN_ID}: ${RUN_URL}"
  echo "  完成时间: ${RUN_TIME} (${HOURS_AGO}h ago)"
  echo ""
  echo "  解决方案："
  echo "  1. 等待今夜 nightly 或手动触发: gh workflow run ${WORKFLOW_FILE} --ref main"
  echo "  2. 紧急绕过: BYPASS_NIGHTLY_GATE=1"
  exit 1
fi

# ── 落章：打印绿色证据 ─────────────────────────────────────────────────────────

echo ""
echo "✅ 刀C Release Gate 通过"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  证据类型  : ${WORKFLOW_FILE} (刀A nightly 回归闸)"
echo "  Run ID    : #${RUN_ID}"
echo "  Commit    : ${RUN_SHA_SHORT}"
echo "  完成时间  : ${RUN_TIME}"
if [ "$RUN_EPOCH" -gt 0 ]; then
  echo "  距今      : ${HOURS_AGO}h（窗口 ${WINDOW_HOURS}h）"
fi
echo "  链接      : ${RUN_URL}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# GitHub Actions step summary 落章
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  cat >> "$GITHUB_STEP_SUMMARY" <<EOF

## ✅ 刀C Release Gate — 通过

| 字段 | 值 |
|---|---|
| 证据来源 | \`${WORKFLOW_FILE}\` (刀A nightly 回归闸) |
| Run ID | [#${RUN_ID}](${RUN_URL}) |
| Commit | \`${RUN_SHA_SHORT}\` |
| 完成时间 | \`${RUN_TIME}\` |
| 距今 | ${HOURS_AGO}h（窗口 ${WINDOW_HOURS}h）|

EOF
fi
