#!/usr/bin/env bash
# host-disk-sampler.sh — 宿主磁盘采样器
#
# 每分钟由宿主 crontab 调用一次（部署方手工安装，见 PR 描述里的 crontab 行）。
# 采样 data_avail_bytes（df）与 apfs_unallocated_bytes（diskutil），
# 原子写入 <DEPLOY_ROOT>/.runtime/host-disk.json，供 capacity-gate.js 的
# readHostDisk() 消费（本脚本是系统内唯一直接调用 df/diskutil 的地方）。
#
# 用法：
#   bash scripts/host-disk-sampler.sh
#
# 环境变量：
#   CECELIA_DEPLOY_ROOT   测试钩子/部署根显式指定（默认按 git 主仓库解析，同 deploy-local.sh 惯例）
#
# 2026-07-20 磁盘几乎打满事故根因之一：cron 默认 PATH 只有 /usr/bin:/bin，
# 找不到装在 /usr/sbin（diskutil）/opt/homebrew/bin 下的工具。本脚本显式声明 PATH，
# 不依赖调用方（cron/测试）传入的 PATH。

set -euo pipefail

export PATH="/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"

# ── 部署根解析（与 scripts/deploy-local.sh 惯例一致：CECELIA_DEPLOY_ROOT 测试钩子优先）──
if [[ -n "${CECELIA_DEPLOY_ROOT:-}" ]]; then
  DEPLOY_ROOT="$(cd "$CECELIA_DEPLOY_ROOT" && pwd)"
else
  GIT_COMMON=$(git -C "$SCRIPT_DIR" rev-parse --git-common-dir 2>/dev/null || echo "")
  if [[ -n "$GIT_COMMON" ]]; then
    if [[ "$GIT_COMMON" == ".git" ]]; then
      DEPLOY_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
    else
      DEPLOY_ROOT="$(cd "$(dirname "$GIT_COMMON")" && pwd)"
    fi
  else
    DEPLOY_ROOT="/Users/administrator/perfect21/cecelia"
  fi
fi

RUNTIME_DIR="${DEPLOY_ROOT}/.runtime"
JSON_PATH="${RUNTIME_DIR}/host-disk.json"

mkdir -p "$RUNTIME_DIR"

# ── 采样 data_avail_bytes（df，1024-blocks 换算字节）──────────────────────────
DF_LINE=$(df -k /System/Volumes/Data 2>/dev/null | tail -1 || true)
if [ -z "$DF_LINE" ]; then
  DF_LINE=$(df -k / | tail -1)
fi
AVAIL_BLOCKS=$(echo "$DF_LINE" | awk '{print $4}')
DATA_AVAIL_BYTES=$((AVAIL_BLOCKS * 1024))
USAGE_PCT_RAW=$(echo "$DF_LINE" | awk '{print $5}' | tr -d '%')
USAGE_PCT=${USAGE_PCT_RAW:-0}

# ── 采样 apfs_unallocated_bytes（diskutil Container Free Space）─────────────
APFS_LINE=$(diskutil info / 2>/dev/null | grep -m1 "Container Free Space" || true)
APFS_UNALLOCATED_BYTES=""
if [ -n "$APFS_LINE" ]; then
  APFS_UNALLOCATED_BYTES=$(echo "$APFS_LINE" | sed -nE 's/.*\(([0-9]+) Bytes\).*/\1/p')
fi
if [ -z "$APFS_UNALLOCATED_BYTES" ]; then
  # diskutil 输出格式不含预期字段（非 APFS 卷等）时，退化为与 data_avail_bytes 一致，
  # 不让采样整体失败（宁可两个字段一致也不能让 cron 静默瘫痪）。
  APFS_UNALLOCATED_BYTES=$DATA_AVAIL_BYTES
fi

# ── effective_free_bytes = min(data_avail_bytes, apfs_unallocated_bytes) ───
if [ "$DATA_AVAIL_BYTES" -le "$APFS_UNALLOCATED_BYTES" ]; then
  EFFECTIVE_FREE_BYTES=$DATA_AVAIL_BYTES
else
  EFFECTIVE_FREE_BYTES=$APFS_UNALLOCATED_BYTES
fi

SAMPLED_AT_EPOCH=$(date +%s)

# ── 原子写：写临时文件 + mv 同文件系统原子替换（不产生可被并发读者看到的半写状态）──
TMP_FILE=$(mktemp "${RUNTIME_DIR}/host-disk.json.tmp.XXXXXX")
cat > "$TMP_FILE" <<EOF
{
  "sampled_at_epoch": ${SAMPLED_AT_EPOCH},
  "data_avail_bytes": ${DATA_AVAIL_BYTES},
  "apfs_unallocated_bytes": ${APFS_UNALLOCATED_BYTES},
  "effective_free_bytes": ${EFFECTIVE_FREE_BYTES},
  "usage_pct": ${USAGE_PCT}
}
EOF
mv "$TMP_FILE" "$JSON_PATH"

echo "[host-disk-sampler] 采样完成 → ${JSON_PATH} (effective_free_bytes=${EFFECTIVE_FREE_BYTES} usage_pct=${USAGE_PCT})"
