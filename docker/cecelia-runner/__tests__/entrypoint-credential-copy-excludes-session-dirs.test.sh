#!/usr/bin/env bash
#
# 回归测试：entrypoint.sh 凭据复制步骤不应拷贝账号 home 目录下的高频变动会话数据
#
# 验证 Bug 修复（issue d4e0ec91）：entrypoint.sh 第 31 行原先 `cp -aL "$HOST_CFG/." "$LOCAL_CFG/"`
# 复制整个账号 home 目录（含 projects/ 会话历史），当该账号被多个并发容器同时使用时，
# projects/ 目录在被其他并发的活跃会话实时读写，导致复制随机卡死或中途失败——
# 实测复现：失败容器内 /home/cecelia/.claude/ 完全没有 .credentials.json，
# 因为复制在到达它之前就被并发读写打断。
#
# 修复：只复制凭据/配置相关的必需文件，跳过 projects/sessions/file-history/telemetry/
# shell-snapshots/paste-cache/cache 这些高频变动、体积大、容器一次性任务不需要的目录。
#
# 测试策略：
#   - 用假的 HOST_CFG 目录模拟账号 home（含 .credentials.json + 一个 projects/ 大目录）
#   - 提取 entrypoint.sh 中"复制配置到可写副本"这段代码，在沙箱中对假目录执行
#   - 断言 .credentials.json 被复制、projects/ 没有被复制
#

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENTRYPOINT="$SCRIPT_DIR/../entrypoint.sh"

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

TESTS_PASSED=0
TESTS_FAILED=0

pass() { echo -e "${GREEN}✓${NC} $1"; TESTS_PASSED=$((TESTS_PASSED + 1)); }
fail() { echo -e "${RED}✗${NC} $1"; TESTS_FAILED=$((TESTS_FAILED + 1)); }

# 提取 entrypoint.sh 中 "1. 复制只读配置到可写副本" 这一段代码块（HOST_CFG 判断到
# session-env mkdir 之间），在独立的假目录上执行，不依赖真实容器环境。
run_copy_block() {
  local host_cfg="$1"
  local local_cfg="$2"

  # 从 entrypoint.sh 原样摘取该代码段，避免测试和实现脱节（脱节了就测不出回归）
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
  echo '{"accessToken":"fake-token-for-test"}' > "$dir/.credentials.json"
  echo '{"some":"config"}' > "$dir/.claude.json"
  mkdir -p "$dir/skills"
  echo '# fake skill' > "$dir/skills/SKILL.md"
  # 模拟高频变动的大型会话历史目录（真实场景是并发写入源）
  mkdir -p "$dir/projects/fake-session/subagents"
  for i in $(seq 1 20); do
    echo "fake transcript line $i" > "$dir/projects/fake-session/agent-$i.jsonl"
  done
  mkdir -p "$dir/sessions"
  echo "fake session state" > "$dir/sessions/state.json"
  mkdir -p "$dir/file-history"
  echo "fake history" > "$dir/file-history/1.txt"
}

# ── 测试 1：.credentials.json 必须被复制 ──────────────────────────────────
test_credentials_copied() {
  local host_cfg local_cfg
  host_cfg=$(mktemp -d)
  local_cfg=$(mktemp -d)
  setup_fake_host_cfg "$host_cfg"

  run_copy_block "$host_cfg" "$local_cfg" >/dev/null 2>&1

  if [[ -f "$local_cfg/.credentials.json" ]]; then
    pass ".credentials.json 已复制到可写副本"
  else
    fail ".credentials.json 未被复制（凭据丢失，容器内会报 Not logged in）"
  fi

  rm -rf "$host_cfg" "$local_cfg"
}

# ── 测试 2：skills/ 必须被复制（harness skills 可见性依赖它）──────────────
test_skills_copied() {
  local host_cfg local_cfg
  host_cfg=$(mktemp -d)
  local_cfg=$(mktemp -d)
  setup_fake_host_cfg "$host_cfg"

  run_copy_block "$host_cfg" "$local_cfg" >/dev/null 2>&1

  if [[ -f "$local_cfg/skills/SKILL.md" ]]; then
    pass "skills/ 已复制到可写副本"
  else
    fail "skills/ 未被复制（harness skills 会在容器内不可见）"
  fi

  rm -rf "$host_cfg" "$local_cfg"
}

# ── 测试 3：projects/ 不应被复制（高频并发写入源，且一次性任务不需要）────
test_projects_excluded() {
  local host_cfg local_cfg
  host_cfg=$(mktemp -d)
  local_cfg=$(mktemp -d)
  setup_fake_host_cfg "$host_cfg"

  run_copy_block "$host_cfg" "$local_cfg" >/dev/null 2>&1

  if [[ ! -e "$local_cfg/projects" ]]; then
    pass "projects/ 未被复制（避免并发读写导致的卡死/丢文件）"
  else
    fail "projects/ 仍被复制（会话历史目录，是并发卡死的根因，应排除）"
  fi

  rm -rf "$host_cfg" "$local_cfg"
}

# ── 测试 4：sessions/、file-history/ 不应被复制 ────────────────────────────
test_other_volatile_dirs_excluded() {
  local host_cfg local_cfg
  host_cfg=$(mktemp -d)
  local_cfg=$(mktemp -d)
  setup_fake_host_cfg "$host_cfg"

  run_copy_block "$host_cfg" "$local_cfg" >/dev/null 2>&1

  local ok=1
  if [[ -e "$local_cfg/sessions" ]]; then
    fail "sessions/ 仍被复制，应排除"
    ok=0
  fi
  if [[ -e "$local_cfg/file-history" ]]; then
    fail "file-history/ 仍被复制，应排除"
    ok=0
  fi
  if [[ $ok -eq 1 ]]; then
    pass "sessions/ 和 file-history/ 均未被复制"
  fi

  rm -rf "$host_cfg" "$local_cfg"
}

# ── 测试 5：session-env 可写目录仍然会被创建 ───────────────────────────────
test_session_env_created() {
  local host_cfg local_cfg
  host_cfg=$(mktemp -d)
  local_cfg=$(mktemp -d)
  setup_fake_host_cfg "$host_cfg"

  run_copy_block "$host_cfg" "$local_cfg" >/dev/null 2>&1

  if [[ -d "$local_cfg/session-env" ]]; then
    pass "session-env/ 可写目录已创建"
  else
    fail "session-env/ 可写目录未创建"
  fi

  rm -rf "$host_cfg" "$local_cfg"
}

echo "=== entrypoint-credential-copy-excludes-session-dirs 回归测试 ==="
echo ""
test_credentials_copied
test_skills_copied
test_projects_excluded
test_other_volatile_dirs_excluded
test_session_env_created
echo ""
echo "结果：${TESTS_PASSED} 通过，${TESTS_FAILED} 失败"

if [[ $TESTS_FAILED -gt 0 ]]; then
  exit 1
fi
exit 0
