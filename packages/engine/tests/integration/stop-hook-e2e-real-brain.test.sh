#!/usr/bin/env bash
# stop-hook-e2e-real-brain.test.sh — real-env-smoke 合成
# 假定 docker compose Brain 已起在 5221（real-env-smoke job 起的）
# Brain 不健康时 exit 0 容错跳过（开发环境兼容）
set -uo pipefail
PASS=0; FAIL=0
pass() { echo "✅ $1"; PASS=$((PASS+1)); }
fail() { echo "❌ $1"; FAIL=$((FAIL+1)); }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
BRAIN_URL="${BRAIN_HEALTH_URL:-http://localhost:5221/api/brain/health}"

if ! curl -fsS --max-time 5 "$BRAIN_URL" >/dev/null 2>&1; then
    echo "⚠️  Brain 未起 [$BRAIN_URL]，本测试需 docker compose Brain（real-env-smoke job 起）— 跳过"
    exit 0
fi
pass "前置: Brain 健康 [$BRAIN_URL]"

TMP_MAIN=$(mktemp -d)
mkdir -p "$TMP_MAIN/.cecelia" "$TMP_MAIN/docs/learnings" "$TMP_MAIN/packages/engine/skills/dev/scripts" "$TMP_MAIN/packages/engine/lib" "$TMP_MAIN/packages/engine/hooks"

cat > "$TMP_MAIN/.cecelia/dev-active-cp-test-real.json" <<EOF
{
  "branch": "cp-test-real",
  "worktree": "/tmp/wt-real",
  "started_at": "2026-05-05T10:00:00+08:00",
  "session_id": "real-test-$$"
}
EOF
echo -e "### 根本原因\nfoo\n### 下次预防\n- [ ] bar" > "$TMP_MAIN/docs/learnings/cp-test-real.md"
cp "$REPO_ROOT/packages/engine/lib/devloop-check.sh" "$TMP_MAIN/packages/engine/lib/"
cp "$REPO_ROOT/packages/engine/hooks/stop-dev.sh" "$TMP_MAIN/packages/engine/hooks/"
echo '#!/usr/bin/env bash
exit 0' > "$TMP_MAIN/packages/engine/skills/dev/scripts/cleanup.sh"
chmod +x "$TMP_MAIN/packages/engine/skills/dev/scripts/cleanup.sh"

# init git so worktree list 返第一行为 TMP_MAIN
mkdir -p "$TMP_MAIN/wt-real"
ln -sf "$TMP_MAIN/wt-real" /tmp/wt-real 2>/dev/null || true
(cd "$TMP_MAIN" && git init -q && git add -A && git -c user.email=t@t -c user.name=t commit -qm init && git branch -M main && git branch cp-test-real)
pass "mock 主仓库 + dev-active 就位"

STUB=$(mktemp -d)
cat > "$STUB/gh" <<'STUB'
#!/usr/bin/env bash
json_field=""
for ((i=1; i<=$#; i++)); do
    [[ "${!i}" == "--json" ]] && { j=$((i+1)); json_field="${!j}"; }
done
case "$1 $2" in
    "pr list") echo "100" ;;
    "pr view")
        case "$json_field" in
            mergedAt) echo "2026-05-05T02:00:00Z" ;;
            mergeCommit) echo '{"oid":"abc123def"}' ;;
        esac ;;
    "run list")
        case "$json_field" in
            status) echo "completed" ;;
            conclusion) echo "success" ;;
            databaseId) echo "999" ;;
            *) echo '[{"databaseId":2001,"headSha":"abc123def"}]' ;;
        esac ;;
    "run view")
        case "$json_field" in
            status) echo "completed" ;;
            conclusion) echo "success" ;;
            jobs) echo '{"jobs":[]}' ;;
        esac ;;
esac
exit 0
STUB
chmod +x "$STUB/gh"

export PATH="$STUB:$PATH"
export CLAUDE_HOOK_CWD="$TMP_MAIN"
output=$(bash "$TMP_MAIN/packages/engine/hooks/stop-dev.sh" 2>&1 || echo "EXIT=$?")
echo "stop-dev output: $output" | head -10

if [[ ! -f "$TMP_MAIN/.cecelia/dev-active-cp-test-real.json" ]]; then
    pass "done 路径 rm dev-active 成功（P5+P6 真链路通）"
else
    echo "  实际 output: $output"
    fail "dev-active 仍在 — P5/P6 链路有断点"
fi

rm -rf "$TMP_MAIN" "$STUB"
rm -f /tmp/wt-real

echo ""
echo "=== stop-hook-e2e-real-brain: $PASS PASS / $FAIL FAIL ==="
[[ "$FAIL" -eq 0 ]]
