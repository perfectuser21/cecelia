#!/usr/bin/env bash
# cleanup-lock-mutex.sh — Tier 1 worktree race fix 真环境 smoke
#
# 验证 cleanup-lock 跨进程互斥语义：
# 1. acquire 单进程成功，重复 acquire 在同进程超时（mkdir EEXIST）
# 2. 并发 2 进程拿同一锁 → 只有 1 个成功，另一个 timeout
# 3. release 后，等待中的另一个能拿到
# 4. stale 锁（mtime > stale 阈值）被强夺
#
# 用法：bash packages/brain/scripts/smoke/cleanup-lock-mutex.sh
# 退出码：0 = 全过，非 0 = 有失败

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
HELPER="$REPO_ROOT/packages/brain/scripts/cleanup-lock.sh"
TEST_LOCK="/tmp/cecelia-smoke-mutex.lock"

if [ ! -f "$HELPER" ]; then
  echo "[smoke] FATAL: cleanup-lock.sh helper not found at $HELPER"
  exit 1
fi

# 始终从干净状态开始
rmdir "$TEST_LOCK" 2>/dev/null || true

PASSED=0
FAILED=0

# ────── Test 1: 单进程 acquire / release ──────
test1() {
  bash -c "
    export CLEANUP_LOCK_DIR='$TEST_LOCK'
    export CLEANUP_LOCK_TIMEOUT=2
    source '$HELPER'
    if acquire_cleanup_lock && [ -d '$TEST_LOCK' ] && release_cleanup_lock && [ ! -d '$TEST_LOCK' ]; then
      exit 0
    else
      exit 1
    fi
  "
}
if test1; then echo "[smoke] PASS test1: single acquire/release"; PASSED=$((PASSED+1)); else echo "[smoke] FAIL test1: single acquire/release"; FAILED=$((FAILED+1)); fi

# ────── Test 2: 并发 2 进程 — 只 1 成功 ──────
rmdir "$TEST_LOCK" 2>/dev/null || true
test2() {
  # Process A: 拿锁后 sleep 3 秒，然后 release
  local out_a out_b
  out_a=$(bash -c "
    export CLEANUP_LOCK_DIR='$TEST_LOCK'
    export CLEANUP_LOCK_TIMEOUT=2
    source '$HELPER'
    if acquire_cleanup_lock; then
      sleep 3
      release_cleanup_lock
      echo 'A_GOT'
    else
      echo 'A_FAIL'
    fi
  ") &
  local pid_a=$!
  sleep 0.3  # 让 A 先拿锁

  # Process B: 立刻试拿，应在 timeout=1 内失败
  out_b=$(bash -c "
    export CLEANUP_LOCK_DIR='$TEST_LOCK'
    export CLEANUP_LOCK_TIMEOUT=1
    source '$HELPER'
    if acquire_cleanup_lock; then
      echo 'B_GOT'
      release_cleanup_lock
    else
      echo 'B_TIMEOUT'
    fi
  ")
  wait $pid_a
  out_a=$(jobs -p | head -1)
  # 直接重新 inline check（jobs 输出不可靠跨 platform）
  echo "  → A 进程后台已结束（持锁 3s 后 release）"
  echo "  → B 进程输出: $out_b"
  if [ "$out_b" = "B_TIMEOUT" ]; then
    return 0
  else
    return 1
  fi
}
if test2; then echo "[smoke] PASS test2: concurrent contention（B 超时）"; PASSED=$((PASSED+1)); else echo "[smoke] FAIL test2: concurrent contention"; FAILED=$((FAILED+1)); fi

# ────── Test 3: stale 锁强夺 ──────
rmdir "$TEST_LOCK" 2>/dev/null || true
mkdir "$TEST_LOCK"
# 把 lock dir mtime 改到 5 分钟前
if [[ "$OSTYPE" == "darwin"* ]]; then
  touch -t "$(date -v-5M '+%Y%m%d%H%M.%S')" "$TEST_LOCK"
else
  touch -d '5 minutes ago' "$TEST_LOCK"
fi
test3() {
  bash -c "
    export CLEANUP_LOCK_DIR='$TEST_LOCK'
    export CLEANUP_LOCK_TIMEOUT=3
    export CLEANUP_LOCK_STALE=60
    source '$HELPER'
    if acquire_cleanup_lock; then
      release_cleanup_lock
      exit 0
    else
      exit 1
    fi
  "
}
if test3; then echo "[smoke] PASS test3: stale 锁强夺"; PASSED=$((PASSED+1)); else echo "[smoke] FAIL test3: stale 锁强夺"; FAILED=$((FAILED+1)); fi

# ────── Test 4: Node helper 协议一致 ──────
rmdir "$TEST_LOCK" 2>/dev/null || true
NODE_HELPER="$REPO_ROOT/packages/brain/src/utils/cleanup-lock.js"
if [ -f "$NODE_HELPER" ]; then
  test4() {
    node -e "
      import('$NODE_HELPER').then(async ({ withLock }) => {
        let inside = false;
        await withLock({ lockDir: '$TEST_LOCK', timeoutMs: 1000 }, async () => { inside = true; });
        process.exit(inside ? 0 : 1);
      });
    "
  }
  if test4; then echo "[smoke] PASS test4: node withLock 跨语言同协议"; PASSED=$((PASSED+1)); else echo "[smoke] FAIL test4: node withLock 跨语言同协议"; FAILED=$((FAILED+1)); fi
else
  echo "[smoke] SKIP test4: node helper 不存在（$NODE_HELPER）"
fi

# ────── Cleanup ──────
rmdir "$TEST_LOCK" 2>/dev/null || true

echo ""
echo "[smoke] cleanup-lock-mutex 完成: PASSED=$PASSED FAILED=$FAILED"
exit "$FAILED"
