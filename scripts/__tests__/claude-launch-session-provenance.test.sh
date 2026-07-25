#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LAUNCHER="$REPO_ROOT/scripts/claude-launch.sh"
TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

cat > "$TMP_ROOT/claude" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$CLAUDE_LOG"
exit 0
EOF

cat > "$TMP_ROOT/psql" <<'EOF'
#!/usr/bin/env bash
printf 'timeout=%s args=%s\n' "${PGCONNECT_TIMEOUT:-}" "$*" >> "$PSQL_LOG"
exit "${PSQL_EXIT:-0}"
EOF
chmod +x "$TMP_ROOT/claude" "$TMP_ROOT/psql"

run_launcher() {
  env \
    PATH="$TMP_ROOT:$PATH" \
    CLAUDE_CODE_EXECPATH="$TMP_ROOT/claude" \
    CLAUDE_LOG="$TMP_ROOT/claude.log" \
    PSQL_LOG="$TMP_ROOT/psql.log" \
    CECELIA_NO_AUTO_WORKTREE=1 \
    "$@"
}

: > "$TMP_ROOT/psql.log"
: > "$TMP_ROOT/claude.log"
run_launcher CECELIA_DISPATCH=1 CECELIA_LAUNCHED_BY=cecelia-run \
  HARNESS_TASK_ID=00000000-0000-4000-8000-000000000001 \
  CLAUDE_SESSION_ID=machine-session bash "$LAUNCHER" -p probe
grep -Fq "machine" "$TMP_ROOT/psql.log"
grep -Fq "cecelia-run" "$TMP_ROOT/psql.log"
grep -Fq "timeout=2" "$TMP_ROOT/psql.log"
[[ "$(grep -c '^timeout=' "$TMP_ROOT/psql.log")" == "1" ]]

: > "$TMP_ROOT/psql.log"
script -qec "env PATH='$TMP_ROOT:$PATH' CLAUDE_CODE_EXECPATH='$TMP_ROOT/claude' CLAUDE_LOG='$TMP_ROOT/claude.log' PSQL_LOG='$TMP_ROOT/psql.log' CECELIA_NO_AUTO_WORKTREE=1 CLAUDE_SESSION_ID=human-session bash '$LAUNCHER'" /dev/null >/dev/null
grep -Fq "human" "$TMP_ROOT/psql.log"
grep -Fq "claude-launch-interactive" "$TMP_ROOT/psql.log"

: > "$TMP_ROOT/psql.log"
run_launcher CLAUDE_SESSION_ID=unknown-session bash "$LAUNCHER" -p probe
[[ ! -s "$TMP_ROOT/psql.log" ]]

: > "$TMP_ROOT/psql.log"
: > "$TMP_ROOT/claude.log"
run_launcher PSQL_EXIT=1 CECELIA_DISPATCH=1 CLAUDE_SESSION_ID=failed-registration \
  bash "$LAUNCHER" -p probe
[[ -s "$TMP_ROOT/psql.log" ]]
[[ -s "$TMP_ROOT/claude.log" ]]

: > "$TMP_ROOT/psql.log"
run_launcher CECELIA_DISPATCH=1 CLAUDE_SESSION_ID=dry-run \
  bash "$LAUNCHER" --dry-run -p probe >/dev/null
[[ ! -s "$TMP_ROOT/psql.log" ]]

echo "OK: claude launcher provenance branches passed"
