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

# ── 单飞 + 陈旧锁自愈 ────────────────────────────────────────────────────────
# 2026-08-18 事故：diskutil 挂死 5 小时，而 crontab 外层用的是 `flock -n`——后续
# 每分钟的采样全部**静默**跳过，样本永久陈旧 → 容量闸 sample_stale → 所有 PR 的
# Deploy Preview 必挂。两条教训写进脚本：①单飞归脚本自己管，不依赖调用方；
# ②跳过必须出声，静默跳过等于故障隐身；③持锁者卡死后锁要能被抢占，否则一次挂死
# 就是永久停摆。
LOCK_DIR="${RUNTIME_DIR}/host-disk-sampler.lock"
LOCK_STALE_SECONDS="${HOST_DISK_LOCK_STALE_SECONDS:-300}"

if [ -d "$LOCK_DIR" ]; then
  # BSD stat 用 -f，GNU stat 用 -c；GNU 的 -f 是 --file-system，遇到 %m 不报错却吐出
  # 非数字，直接喂进算术展开会在 set -e 下打死整个脚本。必须校验是纯数字。
  LOCK_MTIME=$(stat -f %m "$LOCK_DIR" 2>/dev/null || stat -c %Y "$LOCK_DIR" 2>/dev/null || echo 0)
  [[ "$LOCK_MTIME" =~ ^[0-9]+$ ]] || LOCK_MTIME=0
  LOCK_AGE=$(( $(date +%s) - LOCK_MTIME ))
  if [ "$LOCK_AGE" -ge "$LOCK_STALE_SECONDS" ]; then
    echo "[host-disk-sampler] 锁已陈旧（持有 ${LOCK_AGE}s ≥ ${LOCK_STALE_SECONDS}s），判定上一轮已死，抢占继续采样" >&2
    rmdir "$LOCK_DIR" 2>/dev/null || true
  fi
fi

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "[host-disk-sampler] 上一轮仍在运行，本轮跳过；连续出现说明采样卡住，样本会变陈旧" >&2
  exit 0
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

# ── 带超时地跑一条采样命令 ──────────────────────────────────────────────────
# macOS 自带没有 coreutils 的 timeout，不能依赖它存在；用后台进程 + 轮询实现，
# 超时就把整个进程组打掉（diskutil 会派生子进程）。
SAMPLE_TIMEOUT_SECONDS="${HOST_DISK_SAMPLE_TIMEOUT_SECONDS:-20}"

run_with_timeout() {
  # $1=输出文件，其余=要执行的命令
  local out_file="$1"; shift
  local waited=0 pid

  ( "$@" >"$out_file" 2>/dev/null ) &
  pid=$!

  while kill -0 "$pid" 2>/dev/null; do
    if [ "$waited" -ge "$SAMPLE_TIMEOUT_SECONDS" ]; then
      kill -9 "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
      echo "[host-disk-sampler] 采样命令超时（${SAMPLE_TIMEOUT_SECONDS}s）已强杀：$*" >&2
      return 124
    fi
    sleep 1
    waited=$((waited + 1))
  done
  wait "$pid" 2>/dev/null || true
  return 0
}

# ── 采样 data_avail_bytes（df，1024-blocks 换算字节）──────────────────────────
DF_OUT="${RUNTIME_DIR}/.host-disk-df.$$"
DF_LINE=""
if run_with_timeout "$DF_OUT" df -k /System/Volumes/Data; then
  DF_LINE=$(tail -1 "$DF_OUT" 2>/dev/null || true)
fi
if [ -z "$DF_LINE" ]; then
  if run_with_timeout "$DF_OUT" df -k /; then
    DF_LINE=$(tail -1 "$DF_OUT" 2>/dev/null || true)
  fi
fi
rm -f "$DF_OUT"
if [ -z "$DF_LINE" ]; then
  # df 都拿不到就没有任何可信数据了——必须硬失败，绝不能写出半真的样本让容量闸误放行。
  echo "[host-disk-sampler] df 采样失败或超时，拒绝写出样本" >&2
  exit 1
fi
AVAIL_BLOCKS=$(echo "$DF_LINE" | awk '{print $4}')
DATA_AVAIL_BYTES=$((AVAIL_BLOCKS * 1024))
USAGE_PCT_RAW=$(echo "$DF_LINE" | awk '{print $5}' | tr -d '%')
USAGE_PCT=${USAGE_PCT_RAW:-0}

# ── 采样 apfs_unallocated_bytes（diskutil Container Free Space）─────────────
# CECELIA_DISKUTIL_BIN：测试钩子（同 CECELIA_DEPLOY_ROOT 惯例）。脚本显式前置系统
# PATH 以防 cron PATH 事故，因此注入必须走显式变量而不是 PATH 覆盖。
DISKUTIL_BIN="${CECELIA_DISKUTIL_BIN:-diskutil}"
DISKUTIL_OUT="${RUNTIME_DIR}/.host-disk-diskutil.$$"
APFS_LINE=""
if run_with_timeout "$DISKUTIL_OUT" "$DISKUTIL_BIN" info /; then
  APFS_LINE=$(grep -m1 "Container Free Space" "$DISKUTIL_OUT" 2>/dev/null || true)
fi
rm -f "$DISKUTIL_OUT"
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
