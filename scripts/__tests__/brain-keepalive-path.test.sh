#!/usr/bin/env bash
# Regression: brain-keepalive-check.sh 在 cron/launchd 极简 PATH 下必须能找到 docker，
# 且要区分「docker 命令不存在（脚本 PATH 配置问题）」与「docker daemon 真不可用」。
# 历史 bug：cron PATH 无 /opt/homebrew/bin → docker 找不到 → 被误判成 daemon 挂了 →
# 永不触发 `docker compose up`，兜底长期失效。
set -uo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
TARGET="$SCRIPT_DIR/../ops/brain-keepalive-check.sh"
PASS=0
FAIL=0

ok()   { echo "  ✅ $1"; PASS=$((PASS+1)); }
bad()  { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

[[ -f "$TARGET" ]] || { echo "FAIL: 找不到目标脚本 $TARGET"; exit 1; }

# ── 沙箱：一个只含必需 coreutils、绝不含 docker 的 PATH ──────────────────
SANDBOX="$(mktemp -d)"
for bin in bash dirname date stat touch rm cat sleep sed grep; do
  real="$(command -v "$bin" 2>/dev/null || true)"
  [[ -n "$real" ]] && ln -sf "$real" "$SANDBOX/$bin"
done
# 断言沙箱里确实没有 docker（否则场景不成立）
if command -v "$SANDBOX/docker" >/dev/null 2>&1; then
  echo "FAIL: 沙箱意外包含 docker"; exit 1
fi

STATE="$(mktemp -d)"      # 隔离状态文件目录，绝不碰生产 /tmp/brain-keepalive*.alerting
EMPTY="$(mktemp -d)"      # 空目录，模拟 homebrew 路径里没有 docker
HBSIM="$(mktemp -d)"      # 模拟 /opt/homebrew/bin：docker 只装在这里
THOME="$(mktemp -d)"

cleanup() { rm -rf "$SANDBOX" "$STATE" "$EMPTY" "$HBSIM" "$THOME"; }
trap cleanup EXIT

# 造一个假 docker（用 /bin/bash 避免依赖 env）
make_fake_docker() {
  local dir="$1" mode="$2"
  cat > "$dir/docker" <<FAKE
#!/bin/bash
[[ -n "\${DOCKER_CALL_LOG:-}" ]] && echo "\$@" >> "\$DOCKER_CALL_LOG"
case "$mode" in
  daemon_down)
    [[ "\$1" == "info" ]] && exit 1
    [[ "\$1" == "inspect" ]] && { echo "not_found"; exit 1; }
    ;;
  container_running)
    [[ "\$1" == "info" ]] && exit 0
    [[ "\$1" == "inspect" ]] && { echo "running"; exit 0; }
    ;;
  container_stopped)
    [[ "\$1" == "info" ]] && exit 0
    if [[ "\$1" == "inspect" ]]; then
      if [[ -f "\${DOCKER_FAKE_STATE:-}" ]]; then echo "running"; else echo "exited"; fi
      exit 0
    fi
    [[ "\$1" == "compose" ]] && { touch "\$DOCKER_FAKE_STATE"; exit 0; }
    ;;
esac
exit 0
FAKE
  chmod +x "$dir/docker"
}

run_script() {
  # $1 = 额外 PATH 前置目录（模拟 homebrew 覆盖）
  env -i \
    PATH="$SANDBOX" \
    HOME="$THOME" \
    BRAIN_KEEPALIVE_STATE_DIR="$STATE" \
    BRAIN_KEEPALIVE_PATH="$1" \
    BRAIN_KEEPALIVE_RESTART_WAIT_SECONDS="0" \
    DOCKER_CALL_LOG="$STATE/docker-calls.log" \
    DOCKER_FAKE_STATE="$STATE/docker-restarted" \
    FEISHU_BOT_WEBHOOK="" \
    bash "$TARGET" 2>&1
}

echo "== 静态断言 =="
# PATH 显式设置必须出现在任何真实 docker 调用之前（忽略注释行）
path_line=$(grep -n 'export PATH=' "$TARGET" | head -1 | cut -d: -f1)
docker_line=$(grep -nE 'command -v docker|docker[[:space:]]+(inspect|info|compose)' "$TARGET" \
  | grep -vE '^[0-9]+:[[:space:]]*#' | head -1 | cut -d: -f1)
if [[ -n "$path_line" && -n "$docker_line" && "$path_line" -lt "$docker_line" ]]; then
  ok "export PATH 出现在首个 docker 调用之前 (行 $path_line < $docker_line)"
else
  bad "export PATH 未在首个 docker 调用之前 (path=${path_line} docker=${docker_line})"
fi
# 必须用 command -v docker 区分命令存在性
if grep -q 'command -v docker' "$TARGET"; then
  ok "使用 command -v docker 检测命令是否存在"
else
  bad "未使用 command -v docker 检测命令存在性"
fi

echo "== 场景 1：docker 命令不存在（PATH 里根本没 docker）=="
out=$(run_script "$EMPTY")
if grep -qi 'command not found' <<<"$out" && ! grep -qi 'daemon unavailable' <<<"$out"; then
  ok "命令缺失走独立分支，未误判为 daemon unavailable"
else
  bad "命令缺失未正确区分（输出：$(echo "$out" | tr '\n' '|'))"
fi

echo "== 场景 2：docker 命令存在但 daemon 不可用 =="
make_fake_docker "$SANDBOX" daemon_down
out=$(run_script "$EMPTY")
if grep -qi 'daemon unavailable' <<<"$out" && ! grep -qi 'command not found' <<<"$out"; then
  ok "daemon 真不可用走 daemon 分支，未误报命令缺失"
else
  bad "daemon 不可用分支异常（输出：$(echo "$out" | tr '\n' '|'))"
fi
rm -f "$SANDBOX/docker"

echo "== 场景 3：docker 只装在 homebrew 路径下，极简 PATH 也要能找到 =="
make_fake_docker "$HBSIM" container_running
out=$(run_script "$HBSIM")
if grep -qi 'is running' <<<"$out" \
   && ! grep -qi 'command not found' <<<"$out" \
   && ! grep -qi 'daemon unavailable' <<<"$out"; then
  ok "PATH 前置生效，homebrew 下的 docker 被找到，容器判为 running"
else
  bad "PATH 前置未生效（输出：$(echo "$out" | tr '\n' '|'))"
fi

echo "== 场景 4：自动恢复必须加载 production env-file，不能把 Fleet secret 重建为空 =="
rm -f "$STATE/docker-calls.log" "$STATE/docker-restarted"
make_fake_docker "$HBSIM" container_stopped
out=$(run_script "$HBSIM")
expected_env_file="$(cd "$SCRIPT_DIR/../.." && pwd)/.env.docker"
if grep -Fq "compose --env-file $expected_env_file -f" "$STATE/docker-calls.log"; then
  ok "自动恢复 compose 显式加载 .env.docker"
else
  bad "自动恢复未加载 production env-file（calls：$(tr '\n' '|' < "$STATE/docker-calls.log")）"
fi

echo
echo "==== brain-keepalive-path 测试：PASS=$PASS FAIL=$FAIL ===="
[[ "$FAIL" -eq 0 ]] || exit 1
echo "ALL PASS"
