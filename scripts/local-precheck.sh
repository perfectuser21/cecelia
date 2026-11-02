#!/usr/bin/env bash
# Push前本地预检：现役Brain事实、统一版本检查与manifest校验。
# --force运行全部检查；其余情况只在Brain或根版本/预检输入变更时运行。
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

if [[ "${1:-}" == '--force' ]]; then
    CHANGED=99
else
    MERGE_BASE=$(git merge-base HEAD origin/main 2>/dev/null || git rev-parse HEAD~1 2>/dev/null || echo '')
    CHANGED=0
    if [[ -n "$MERGE_BASE" ]]; then
        CHANGED=$(git diff --name-only "$MERGE_BASE" HEAD \
            | { grep -E '^(packages/brain/|scripts/(local-precheck\.sh|facts-check\.mjs|check-version-sync\.sh)$|DEFINITION\.md$|\.brain-versions$|package(-lock)?\.json$)' || true; } \
            | wc -l | tr -d ' ')
    fi
fi

if [[ "$CHANGED" -eq 0 ]]; then
    echo 'Brain及根预检输入无改动'
    exit 0
fi

ERRORS=0
CHECKS_RUN=0
run_check() {
    local label="$1"
    shift
    CHECKS_RUN=$((CHECKS_RUN + 1))
    echo "[$CHECKS_RUN/3] $label"
    if "$@"; then
        echo "✅ $label 通过"
    else
        echo "❌ $label 失败"
        ERRORS=$((ERRORS + 1))
    fi
}

run_check facts-check node scripts/facts-check.mjs
run_check version-sync bash scripts/check-version-sync.sh
run_check manifest-sync node packages/brain/scripts/generate-manifest.mjs --check

if [[ "$ERRORS" -ne 0 ]]; then
    echo "❌ 本地预检失败（$ERRORS 项失败，共 $CHECKS_RUN 项）"
    exit 1
fi
echo "✅ 本地预检全部通过（$CHECKS_RUN 项）"
