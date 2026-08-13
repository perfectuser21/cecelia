#!/usr/bin/env bash
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
HOOK="$ROOT/packages/engine/hooks/dev-mode-tool-guard.sh"
SETTINGS="$ROOT/.claude/settings.json"
TEST_ROOT=$(mktemp -d)
trap 'rm -rf "$TEST_ROOT"' EXIT

git init -b main "$TEST_ROOT/main" >/dev/null
git -C "$TEST_ROOT/main" config user.name 'Routing Guard Test'
git -C "$TEST_ROOT/main" config user.email 'routing@example.invalid'
git -C "$TEST_ROOT/main" config core.hooksPath /dev/null
printf 'base\n' > "$TEST_ROOT/main/base.txt"
git -C "$TEST_ROOT/main" add base.txt
git -C "$TEST_ROOT/main" commit -m base >/dev/null
git -C "$TEST_ROOT/main" worktree add -b cp-routing "$TEST_ROOT/worktree" >/dev/null

BASE_SHA=$(git -C "$TEST_ROOT/worktree" rev-parse HEAD)
mkdir -p "$TEST_ROOT/bin"
cat > "$TEST_ROOT/bin/curl" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$CURL_LOG"
printf '%s\n' '{"valid":true,"routing_receipt_id":"receipt-1","expires_at":"2099-01-01T00:00:00Z"}'
EOF
chmod +x "$TEST_ROOT/bin/curl"
export CURL_LOG="$TEST_ROOT/curl.log"

cat > "$TEST_ROOT/worktree/.dev-lock.cp-routing" <<EOF
{"task_id":"task-1","routing_receipt_id":"receipt-1","run_id":"run-1","repo":"perfectuser21/cecelia","branch":"cp-routing","base_sha":"$BASE_SHA"}
EOF

run_hook() {
  local tool_name="$1"
  local cwd="${2:-$TEST_ROOT/worktree}"
  printf '{"tool_name":"%s","cwd":"%s","tool_input":{}}\n' "$tool_name" "$cwd" \
    | PATH="$TEST_ROOT/bin:$PATH" bash "$HOOK"
}

# 合法 receipt 必须从当前 worktree 读取，并把 run identity 发给 Brain。
run_hook Bash
grep -q 'run-1' "$CURL_LOG"

# 所有 mutation-capable 及未知工具都必须 fail closed。
rm "$TEST_ROOT/worktree/.dev-lock.cp-routing"
if run_hook Edit >/dev/null 2>&1; then
  echo 'Edit without routing receipt was allowed' >&2
  exit 1
fi
if run_hook FutureMutationTool >/dev/null 2>&1; then
  echo 'unknown tool without routing receipt was allowed' >&2
  exit 1
fi

# 明确只读诊断仍可用于修复凭证。
run_hook Read

# 锁中的 baseline 必须是当前 HEAD 的祖先，不能只信 API 的 true。
cat > "$TEST_ROOT/worktree/.dev-lock.cp-routing" <<EOF
{"task_id":"task-1","routing_receipt_id":"receipt-1","run_id":"run-1","repo":"perfectuser21/cecelia","branch":"cp-routing","base_sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}
EOF
if run_hook Bash >/dev/null 2>&1; then
  echo 'non-ancestor baseline was allowed' >&2
  exit 1
fi

for tool in Bash Edit Write MultiEdit NotebookEdit; do
  jq -e --arg tool "$tool" '.hooks.PreToolUse[] | select(.matcher == $tool)' "$SETTINGS" >/dev/null
done

echo 'dev mode routing receipt guard PASS'
