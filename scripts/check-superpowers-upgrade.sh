#!/usr/bin/env bash
# check-superpowers-upgrade.sh
#   检测官方 Superpowers plugin 是否有新版本。
#   sync 文件内记录的版本与本地安装目录最新版本比对。
#   - 一致：输出 [OK] 退出 0
#   - 不一致：输出 [ALERT] 退出 0（下游可 grep ALERT 触发 Brain task）
# 建议由 cron 每月 1 号调用。

set -euo pipefail

SP_DIR="${HOME}/.claude-account3/plugins/cache/superpowers-marketplace/superpowers"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SYNC_FILE="${REPO_ROOT}/docs/roadmap/superpowers-sync.md"

if [[ ! -f "$SYNC_FILE" ]]; then
    echo "missing $SYNC_FILE"
    exit 1
fi

CURRENT=$(grep -oE '[0-9]+\.[0-9]+\.[0-9]+' "$SYNC_FILE" | head -1 || echo "")
if [[ -z "$CURRENT" ]]; then
    echo "[WARN] 无法在 $SYNC_FILE 中解析 Superpowers 版本"
    exit 0
fi

if [[ ! -d "${SP_DIR}" ]]; then
    echo "[INFO] Superpowers 目录不存在（${SP_DIR}），跳过检测"
    exit 0
fi

LATEST=$(ls -d "${SP_DIR}"/*/ 2>/dev/null | sort -V | tail -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || echo "")
if [[ -z "$LATEST" ]]; then
    echo "[INFO] Superpowers 目录中无版本化子目录，跳过"
    exit 0
fi

if [[ "$LATEST" != "$CURRENT" ]]; then
    echo "[ALERT] Superpowers $LATEST 可用 (当前记录 $CURRENT)"
    # 可选：创 Brain task 告警（此处保持注释，cron 运行时再启用）
    # curl -s -X POST localhost:5221/api/brain/tasks \
    #   -H 'Content-Type: application/json' \
    #   -d "{\"title\":\"[ALERT] Superpowers ${LATEST} 可用 (当前 ${CURRENT})\",\"task_type\":\"dev\",\"priority\":\"P1\",\"description\":\"查看 docs/roadmap/superpowers-sync.md 并评估升级影响\"}"
    exit 0
fi

echo "[OK] Superpowers 版本一致: $CURRENT"
exit 0
