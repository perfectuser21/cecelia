#!/usr/bin/env bash
#
# runner-credential-single-chain-smoke.sh — 凭据单链守卫（issue 2bf0f8ea）
#
# 病根：docker/cecelia-runner/entrypoint.sh 把宿主账号目录整目录复制成容器可写副本，
# .credentials.json 也被一并复印。同一账号于是裂成多条独立演化的 OAuth 凭据链，
# 任一副本刷新 token 即作废其余全部（Anthropic 防盗设计）——容器之间互踢，宿主
# 交互窗口也被踢下线（2026-08-08 account1/2 双双掉线，W1-W5 四任务死于此）。
# Codex 无此病，因为它 rw 直挂 CODEX_HOME 原件，全执行体共享同一条链。
#
# 本守卫锁住修法的两条不变量：
#   ① .credentials.json 在容器副本里是**软链**，指回挂载源 $HOST_CFG，不是复印件
#      → 容器内刷新 token 落回宿主唯一原件，全执行体 + 宿主交互窗口共享单链
#   ② 其余配置（.claude.json / skills/ …）仍是各容器独立的真实副本
#      → 并发容器不会互相踩踏会话配置，隔离性与修复前一致
#
# 另加一条 chown 守卫：evaluator 角色会 chown -R 整个 LOCAL_CFG，若穿透软链就会
# 把宿主原件的属主改成容器 UID 999 —— 那是同一种病换个死法（宿主读不了自己的凭据）。
#
# 执行方式：scripts/smoke/*-smoke.sh glob（ci.yml「Dashboard 放行闸 smoke」job 每 PR 必跑）
#

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENTRYPOINT="$REPO_ROOT/docker/cecelia-runner/entrypoint.sh"

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

TESTS_PASSED=0
TESTS_FAILED=0

pass() { echo -e "${GREEN}✓${NC} $1"; TESTS_PASSED=$((TESTS_PASSED + 1)); }
fail() { echo -e "${RED}✗${NC} $1"; TESTS_FAILED=$((TESTS_FAILED + 1)); }

[[ -f "$ENTRYPOINT" ]] || { echo "ERROR: 找不到 entrypoint.sh: $ENTRYPOINT" >&2; exit 1; }

# 标记段缺失 = 摘取到空串 = 断言全在空目录上跑，会伪装成"实现坏了"。先硬失败在这里。
sed -n '/^# config-copy:start$/,/^# config-copy:end$/p' "$ENTRYPOINT" | grep -q . || {
  echo "ERROR: entrypoint.sh 缺 config-copy:start/end 标记段，守卫无法摘取实现" >&2
  exit 1
}

# 从 entrypoint.sh 原样摘取「1. 复制只读配置到可写副本」代码段，在假目录上执行。
# 原样摘取而非复述，是为了让实现一改这里就跟着变——复述会和实现脱节，脱节就测不出回归。
run_copy_block() {
  local host_cfg="$1"
  local local_cfg="$2"
  local copy_block

  copy_block=$(sed -n '/^# config-copy:start$/,/^# config-copy:end$/p' "$ENTRYPOINT")
  if [[ -z "$copy_block" ]]; then
    echo "ERROR: 无法从 entrypoint.sh 提取复制代码段" >&2
    return 1
  fi

  (
    HOST_CFG="$host_cfg"
    LOCAL_CFG="$local_cfg"
    eval "$copy_block"
  )
}

setup_fake_host_cfg() {
  local dir="$1"
  mkdir -p "$dir"
  echo '{"claudeAiOauth":{"accessToken":"host-token-v1","refreshToken":"host-refresh-v1"}}' \
    > "$dir/.credentials.json"
  echo '{"some":"config"}' > "$dir/.claude.json"
  mkdir -p "$dir/skills"
  echo '# fake skill' > "$dir/skills/SKILL.md"
}

# ── 断言 1：.credentials.json 是软链，且指向挂载源 ─────────────────────────
test_credentials_is_symlink_to_host() {
  local host_cfg local_cfg
  host_cfg=$(mktemp -d)
  local_cfg=$(mktemp -d)
  setup_fake_host_cfg "$host_cfg"

  run_copy_block "$host_cfg" "$local_cfg" >/dev/null 2>&1

  if [[ ! -L "$local_cfg/.credentials.json" ]]; then
    fail ".credentials.json 不是软链（仍是复印件 → 凭据链分叉，容器互踢）"
  else
    local target
    target=$(readlink "$local_cfg/.credentials.json")
    if [[ "$target" == "$host_cfg/.credentials.json" ]]; then
      pass ".credentials.json 是软链，指向挂载源原件（${target}）"
    else
      fail ".credentials.json 软链指向了错误目标：${target}（应为 \$HOST_CFG/.credentials.json）"
    fi
  fi

  rm -rf "$host_cfg" "$local_cfg"
}

# ── 断言 2：容器侧刷新 token 会落回宿主原件（单链的实际效果）───────────────
test_container_refresh_reaches_host_file() {
  local host_cfg local_cfg
  host_cfg=$(mktemp -d)
  local_cfg=$(mktemp -d)
  setup_fake_host_cfg "$host_cfg"

  run_copy_block "$host_cfg" "$local_cfg" >/dev/null 2>&1

  # 模拟容器内 claude 刷新凭据：就地改写 CLAUDE_CONFIG_DIR 下的凭据文件
  echo '{"claudeAiOauth":{"accessToken":"container-token-v2","refreshToken":"container-refresh-v2"}}' \
    > "$local_cfg/.credentials.json" 2>/dev/null

  if grep -q 'container-token-v2' "$host_cfg/.credentials.json" 2>/dev/null; then
    pass "容器内刷新的 token 已落回宿主原件（单链成立）"
  else
    fail "容器内刷新的 token 没落回宿主原件（宿主仍持已被作废的旧 token → 被踢下线）"
  fi

  rm -rf "$host_cfg" "$local_cfg"
}

# ── 断言 3：宿主侧刷新对容器立即可见（反向同链）──────────────────────────
test_host_refresh_visible_in_container() {
  local host_cfg local_cfg
  host_cfg=$(mktemp -d)
  local_cfg=$(mktemp -d)
  setup_fake_host_cfg "$host_cfg"

  run_copy_block "$host_cfg" "$local_cfg" >/dev/null 2>&1

  echo '{"claudeAiOauth":{"accessToken":"host-token-v2","refreshToken":"host-refresh-v2"}}' \
    > "$host_cfg/.credentials.json"

  if grep -q 'host-token-v2' "$local_cfg/.credentials.json" 2>/dev/null; then
    pass "宿主刷新后的 token 对容器立即可见（反向同链）"
  else
    fail "容器读到的仍是启动瞬间的快照（宿主刷新后容器持作废 token）"
  fi

  rm -rf "$host_cfg" "$local_cfg"
}

# ── 断言 4：其余配置仍是各容器独立副本（隔离性没被顺手拆掉）────────────────
test_other_config_still_isolated_copies() {
  local host_cfg local_cfg
  host_cfg=$(mktemp -d)
  local_cfg=$(mktemp -d)
  setup_fake_host_cfg "$host_cfg"

  run_copy_block "$host_cfg" "$local_cfg" >/dev/null 2>&1

  local ok=1
  if [[ -L "$local_cfg/.claude.json" ]]; then
    fail ".claude.json 变成了软链（并发容器会互相踩踏宿主配置）"
    ok=0
  fi
  # 容器改自己的配置副本，不得影响宿主原件
  echo '{"some":"container-local-change"}' > "$local_cfg/.claude.json" 2>/dev/null
  if grep -q 'container-local-change' "$host_cfg/.claude.json" 2>/dev/null; then
    fail ".claude.json 的写入穿透到了宿主（隔离性被破坏）"
    ok=0
  fi
  if [[ ! -f "$local_cfg/skills/SKILL.md" ]]; then
    fail "skills/ 未被复制（harness skills 在容器内不可见）"
    ok=0
  fi
  if [[ $ok -eq 1 ]]; then
    pass "除凭据外的配置仍是各容器独立副本（隔离性不变）"
  fi

  rm -rf "$host_cfg" "$local_cfg"
}

# ── 断言 5：evaluator 的 chown 不得穿透凭据软链改宿主原件属主 ───────────────
test_evaluator_chown_does_not_follow_symlink() {
  local chown_line
  chown_line=$(grep -n 'chown -R.*"\$LOCAL_CFG"' "$ENTRYPOINT" | head -1)

  if [[ -z "$chown_line" ]]; then
    fail "找不到 LOCAL_CFG 的 chown 语句（entrypoint 结构变了，守卫需同步更新）"
    return
  fi
  if [[ "$chown_line" == *"chown -R -h"* || "$chown_line" == *"chown -Rh"* ]]; then
    pass "LOCAL_CFG 的 chown 带 -h，不会穿透凭据软链改宿主原件属主"
  else
    fail "LOCAL_CFG 的 chown 缺 -h：会把宿主 .credentials.json 属主改成容器 UID（${chown_line}）"
  fi
}

echo "=== runner-credential-single-chain smoke（issue 2bf0f8ea）==="
echo ""
test_credentials_is_symlink_to_host
test_container_refresh_reaches_host_file
test_host_refresh_visible_in_container
test_other_config_still_isolated_copies
test_evaluator_chown_does_not_follow_symlink
echo ""
echo "结果：${TESTS_PASSED} 通过，${TESTS_FAILED} 失败"

[[ $TESTS_FAILED -gt 0 ]] && exit 1
exit 0
