#!/usr/bin/env bash
# T3 测试：cecelia-run.sh cleanup() trap docker/host 分支
# 验证 [[ -f /.dockerenv ]] 判定 + flag 文件路径生成正确
set -euo pipefail

PASS=0
FAIL=0
TMPDIR_TEST=$(mktemp -d)
trap 'rm -rf "$TMPDIR_TEST"' EXIT

# 模拟 cleanup() 核心分支逻辑（与 cecelia-run.sh L408-418 对齐）
run_cleanup_logic() {
  local cleanup_worktree="$1"
  local dockerenv_stub="$2"  # 本地 stub，真 /.dockerenv 不动
  local flag_dir="$3"

  if [[ -n "$cleanup_worktree" ]]; then
    if [[ -f "$dockerenv_stub" ]]; then
      mkdir -p "$flag_dir" 2>/dev/null || true
      echo "$cleanup_worktree" > "$flag_dir/$(basename "$cleanup_worktree").flag" 2>/dev/null || true
      echo "DOCKER_MODE"
    else
      echo "HOST_MODE"
    fi
  fi
}

# Case 1: host 模式（无 /.dockerenv stub）→ 走 HOST_MODE 分支
echo "[1/3] host 模式（无 dockerenv）"
NO_DOCKERENV="$TMPDIR_TEST/missing-dockerenv"
result=$(run_cleanup_logic "/tmp/fake-wt" "$NO_DOCKERENV" "$TMPDIR_TEST/flags-a")
if [[ "$result" == "HOST_MODE" ]]; then
  echo "  PASS: host 分支走对"
  PASS=$((PASS+1))
else
  echo "  FAIL: 期望 HOST_MODE，实际 $result"
  FAIL=$((FAIL+1))
fi

# Case 2: docker 模式（有 /.dockerenv stub）→ 写 flag 文件
echo "[2/3] docker 模式（有 dockerenv）"
DOCKERENV_STUB="$TMPDIR_TEST/.dockerenv"
touch "$DOCKERENV_STUB"
FLAG_DIR="$TMPDIR_TEST/flags-b"
result=$(run_cleanup_logic "/tmp/fake-wt-docker" "$DOCKERENV_STUB" "$FLAG_DIR")
if [[ "$result" == "DOCKER_MODE" && -f "$FLAG_DIR/fake-wt-docker.flag" ]]; then
  flag_content=$(cat "$FLAG_DIR/fake-wt-docker.flag")
  if [[ "$flag_content" == "/tmp/fake-wt-docker" ]]; then
    echo "  PASS: docker 分支写 flag + 内容正确"
    PASS=$((PASS+1))
  else
    echo "  FAIL: flag 内容错误: $flag_content"
    FAIL=$((FAIL+1))
  fi
else
  echo "  FAIL: docker 分支 / flag 路径错: result=$result exists=$([[ -f "$FLAG_DIR/fake-wt-docker.flag" ]] && echo y || echo n)"
  FAIL=$((FAIL+1))
fi

# Case 3: flag 路径 basename 正确（长路径 → 只取末段文件名）
echo "[3/3] flag 文件名用 basename（长路径）"
DOCKERENV_STUB2="$TMPDIR_TEST/.dockerenv2"
touch "$DOCKERENV_STUB2"
FLAG_DIR2="$TMPDIR_TEST/flags-c"
run_cleanup_logic "/Users/administrator/worktrees/cecelia/deep-path-xyz" "$DOCKERENV_STUB2" "$FLAG_DIR2" >/dev/null
if [[ -f "$FLAG_DIR2/deep-path-xyz.flag" ]]; then
  echo "  PASS: flag 文件名是 basename"
  PASS=$((PASS+1))
else
  echo "  FAIL: 期望 $FLAG_DIR2/deep-path-xyz.flag 存在"
  ls "$FLAG_DIR2/" 2>&1
  FAIL=$((FAIL+1))
fi

echo ""
echo "========================"
echo "Result: PASS=$PASS / FAIL=$FAIL / TOTAL=3"
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
