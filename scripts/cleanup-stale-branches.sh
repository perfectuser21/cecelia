#!/usr/bin/env bash
# cleanup-stale-branches.sh
# 自动清理已 merge 超过 7 days 的 cp-* 远程分支
# 支持分批处理和 API rate limit 保护

set -euo pipefail

DAYS_THRESHOLD=7
BATCH_SIZE=10
SLEEP_BETWEEN_BATCHES=2

echo "[cleanup-stale-branches] 扫描已 merged 超过 ${DAYS_THRESHOLD} day 的 cp-* 远程分支..."

# 计算 7 天前的时间戳（ISO 8601）
CUTOFF_DATE=$(date -u -v-${DAYS_THRESHOLD}d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || \
              date -u -d "${DAYS_THRESHOLD} days ago" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || \
              date -u +%Y-%m-%dT%H:%M:%SZ)

echo "[cleanup-stale-branches] 截止日期: ${CUTOFF_DATE}"

# 获取所有已合并（merged）的 cp-* PR，筛选 merge 时间早于截止日期的
STALE_BRANCHES=$(gh pr list \
    --state merged \
    --search "head:cp-" \
    --json headRefName,mergedAt \
    --limit 500 2>/dev/null | \
    node -e "
        const items = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
        const cutoff = new Date('${CUTOFF_DATE}');
        const stale = items.filter(p =>
            p.headRefName.startsWith('cp-') &&
            p.mergedAt &&
            new Date(p.mergedAt) < cutoff
        );
        stale.forEach(p => console.log(p.headRefName));
    " 2>/dev/null || echo "")

if [[ -z "$STALE_BRANCHES" ]]; then
    echo "[cleanup-stale-branches] 无需清理的 stale 分支（无已 merged 且超过 ${DAYS_THRESHOLD} day 的 cp-* 分支）"
    exit 0
fi

TOTAL=$(echo "$STALE_BRANCHES" | wc -l | tr -d ' ')
echo "[cleanup-stale-branches] 发现 ${TOTAL} 个 stale 分支需要清理"

COUNT=0
BATCH_COUNT=0

while IFS= read -r branch; do
    [[ -z "$branch" ]] && continue

    # 安全过滤：只处理 cp-* 分支，防止误删
    if [[ ! "$branch" == cp-* ]]; then
        echo "[cleanup-stale-branches] 跳过非 cp-* 分支: $branch"
        continue
    fi

    echo "[cleanup-stale-branches] 删除已 merged 远程分支: $branch"
    # git push origin --delete 执行远程分支删除
    git push origin --delete "$branch" 2>/dev/null || \
        echo "[cleanup-stale-branches] 警告：删除 $branch 失败（可能已删除，忽略）" || true

    COUNT=$((COUNT + 1))
    BATCH_COUNT=$((BATCH_COUNT + 1))

    # 分批处理，API rate limit 保护
    if [[ $BATCH_COUNT -ge $BATCH_SIZE ]]; then
        echo "[cleanup-stale-branches] 批次完成（${BATCH_SIZE} 个），等待 ${SLEEP_BETWEEN_BATCHES}s（rate limit 保护）..."
        sleep "$SLEEP_BETWEEN_BATCHES"
        BATCH_COUNT=0
    fi
done <<< "$STALE_BRANCHES"

echo "[cleanup-stale-branches] 完成：共删除 ${COUNT} 个已 merged stale cp-* 分支"
