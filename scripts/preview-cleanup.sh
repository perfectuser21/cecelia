#!/usr/bin/env bash
# preview-cleanup.sh — 预览环境清理脚本（重写为 preview-destroyer.js 的唯一 shell 执行体）
#
# 用法:
#   scripts/preview-cleanup.sh <PR_NUMBER> [REASON]
#
# 本脚本按 pr_number 维度调用统一销毁器 packages/brain/src/preview-destroyer.js 的
# destroyPreview()，与 preview-env-start.sh/preview-env-stop.sh/preview-reaper.sh 的
# pr_number 维度惯例保持一致（旧版按 port 维度找 /tmp/preview-${PORT}.pid 已废弃——
# 与新版 WS1 完整预览环境流程不一致，见合同"已知约束"段）。
#
# 环境变量：
#   REPO_ROOT          （默认 /Users/administrator/perfect21/cecelia）
#   PREVIEW_BASE_DIR    （默认 /Users/administrator/worktrees/cecelia-previews）
#   DB_HOST / DB_USER / DB_PASSWORD / DB_NAME

set -euo pipefail

export PATH="/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
REPO_ROOT="${REPO_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"

PR_NUMBER="${1:-}"
REASON="${2:-manual-cli}"

if [ -z "$PR_NUMBER" ]; then
  echo "ERROR: 必须提供 PR_NUMBER 参数" >&2
  echo "用法: $0 <PR_NUMBER> [REASON]" >&2
  exit 1
fi

if ! [[ "$PR_NUMBER" =~ ^[0-9]+$ ]]; then
  echo "ERROR: PR_NUMBER 必须是数字，实际: $PR_NUMBER" >&2
  exit 1
fi

echo "[preview-cleanup] pr_number=${PR_NUMBER} reason=${REASON}"
echo "[preview-cleanup] 调用统一销毁器 preview-destroyer.js destroyPreview()..."

cd "$REPO_ROOT"
PREVIEW_CLEANUP_PR="$PR_NUMBER" PREVIEW_CLEANUP_REASON="$REASON" node -e "
(async () => {
  const { destroyPreview } = await import('./packages/brain/src/preview-destroyer.js');
  const pool = (await import('./packages/brain/src/db.js')).default;
  const prNumber = parseInt(process.env.PREVIEW_CLEANUP_PR, 10);
  const reason = process.env.PREVIEW_CLEANUP_REASON;
  const result = await destroyPreview(
    prNumber,
    reason,
    'preview-cleanup-cli-' + Date.now(),
    pool,
  );
  console.log('[preview-cleanup] destroyPreview 结果:', JSON.stringify(result));
  await pool.end();
  process.exit(result.destroyed ? 0 : 1);
})().catch((err) => {
  console.error('[preview-cleanup] 执行异常:', err.message);
  process.exit(1);
});
"

echo "[preview-cleanup] ✅ PR#${PR_NUMBER} 清理完成"
