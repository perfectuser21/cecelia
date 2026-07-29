#!/usr/bin/env bash
# Smoke: scripts/check-agents-rules-sync.sh 必须能检测出硬规则摘要漂移，
# 且真实仓库文件（.claude/CLAUDE.md / AGENTS.md）当前必须是同步状态。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/check-agents-rules-sync.sh"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Smoke: check-agents-rules-sync.sh"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [[ ! -f "$SCRIPT" ]]; then
  echo "❌ $SCRIPT 不存在"
  exit 1
fi

WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT

# 场景 1：两份内容一致 → 必须 exit 0
cat > "$WORKDIR/a-sync.md" <<'EOF'
noise before
<!-- HARD_RULES:BEGIN -->
1. 规则一
2. 规则二
<!-- HARD_RULES:END -->
noise after
EOF
cp "$WORKDIR/a-sync.md" "$WORKDIR/b-sync.md"

if bash "$SCRIPT" "$WORKDIR/a-sync.md" "$WORKDIR/b-sync.md" > "$WORKDIR/sync.log" 2>&1; then
  echo "✅ 场景1通过：同步状态下退出码 0"
else
  echo "❌ 场景1失败：同步状态下不应该报错"
  cat "$WORKDIR/sync.log"
  exit 1
fi

# 场景 2：制造漂移 → 必须非零退出 + 报错信息里出现"不一致"提示
cat > "$WORKDIR/a-drift.md" <<'EOF'
<!-- HARD_RULES:BEGIN -->
1. 规则一
2. 规则二
<!-- HARD_RULES:END -->
EOF
cat > "$WORKDIR/b-drift.md" <<'EOF'
<!-- HARD_RULES:BEGIN -->
1. 规则一（被人手动改过，没同步）
2. 规则二
<!-- HARD_RULES:END -->
EOF

set +e
bash "$SCRIPT" "$WORKDIR/a-drift.md" "$WORKDIR/b-drift.md" > "$WORKDIR/drift.log" 2>&1
DRIFT_EXIT=$?
set -e

if [[ "$DRIFT_EXIT" -eq 0 ]]; then
  echo "❌ 场景2失败：制造了漂移，脚本却返回 0"
  cat "$WORKDIR/drift.log"
  exit 1
fi
if ! grep -q "不一致" "$WORKDIR/drift.log"; then
  echo "❌ 场景2失败：报错信息里没有可读的'不一致'提示"
  cat "$WORKDIR/drift.log"
  exit 1
fi
echo "✅ 场景2通过：漂移场景正确报错（exit $DRIFT_EXIT），报错信息含'不一致'提示"

# 场景 3：真实仓库文件必须是同步状态（这是本 smoke 存在的真正目的）
if bash "$SCRIPT" "$REPO_ROOT/.claude/CLAUDE.md" "$REPO_ROOT/AGENTS.md" > "$WORKDIR/real.log" 2>&1; then
  echo "✅ 场景3通过：真实 .claude/CLAUDE.md 与 AGENTS.md 硬规则摘要同步"
else
  echo "❌ 场景3失败：真实仓库文件硬规则摘要已漂移"
  cat "$WORKDIR/real.log"
  exit 1
fi

echo "✅ 全部场景通过"
