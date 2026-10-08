#!/usr/bin/env bash
# quickcheck-lock.sh — quickcheck 的同 repo 互斥锁
#
# acquire_quickcheck_lock <lock_file> <lock_dir>
#   拿到锁返回 0；等待超过 QUICKCHECK_LOCK_WAIT_SEC（默认 600 秒）返回 1。
#   调用方拿不到锁必须失败退出——"跳过并放行"等于没检查就让 push 通过。
#   实现：有 flock 用 flock（进程退出内核自动释放）；否则 mkdir 原子锁，
#   锁目录内写持锁 pid，持锁进程已不存在（被强杀，trap 没跑）时回收陈旧锁。
#   QUICKCHECK_LOCK_IMPL=flock|mkdir 可强制实现（测试用）。

_quickcheck_mtime() {
  # GNU stat 先试（Linux）；BSD stat 不认 -c 会失败，再走 -f %m（macOS）
  stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null || date +%s
}

acquire_quickcheck_lock() {
  local lock_file="$1" lock_dir="$2"
  local wait_sec="${QUICKCHECK_LOCK_WAIT_SEC:-600}"
  [[ "$wait_sec" =~ ^[0-9]+$ ]] || wait_sec=600
  local impl="${QUICKCHECK_LOCK_IMPL:-}"
  if [[ -z "$impl" ]]; then
    if command -v flock >/dev/null 2>&1; then impl=flock; else impl=mkdir; fi
  fi

  if [[ "$impl" == flock ]]; then
    exec 200>"$lock_file"
    if ! flock -n 200; then
      echo "[QuickCheck] 另一个 quickcheck 正在运行，等待其结束（上限 ${wait_sec}s）…" >&2
      flock -w "$wait_sec" 200 || return 1
    fi
    return 0
  fi

  local deadline=$(( $(date +%s) + wait_sec )) announced=0 holder
  while ! mkdir "$lock_dir" 2>/dev/null; do
    holder=$(cat "$lock_dir/pid" 2>/dev/null || true)
    if [[ -n "$holder" ]] && ! kill -0 "$holder" 2>/dev/null; then
      echo "[QuickCheck] 回收陈旧锁（持锁进程 ${holder} 已不存在）" >&2
      rm -rf "$lock_dir"
      continue
    fi
    # 无 pid 文件（旧版脚本留下）且已存在超过 30s：建锁到写 pid 只有毫秒级，视为陈旧锁
    if [[ -z "$holder" ]] && (( $(date +%s) - $(_quickcheck_mtime "$lock_dir") > 30 )); then
      echo "[QuickCheck] 回收无持锁记录的陈旧锁" >&2
      rm -rf "$lock_dir"
      continue
    fi
    if (( $(date +%s) >= deadline )); then return 1; fi
    if (( announced == 0 )); then
      echo "[QuickCheck] 另一个 quickcheck 正在运行（pid ${holder:-?}），等待其结束（上限 ${wait_sec}s）…" >&2
      announced=1
    fi
    sleep 0.2
  done
  echo "$$" > "$lock_dir/pid"
  # shellcheck disable=SC2064
  trap "rm -rf '$lock_dir' 2>/dev/null || true" EXIT INT TERM
  return 0
}
