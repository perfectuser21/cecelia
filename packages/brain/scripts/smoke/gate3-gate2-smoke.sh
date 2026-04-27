#!/usr/bin/env bash
# Gate 3 + Gate 2 smoke — 验证 brain-ci-deploy.yml 结构正确
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
WF="$ROOT/.github/workflows/brain-ci-deploy.yml"

err() { echo "❌ FAIL: $*" >&2; exit 1; }
ok()  { echo "✅ $*"; }

echo "=== Gate 3 + Gate 2 smoke ==="

# 1. 文件存在
[ -f "$WF" ] || err "brain-ci-deploy.yml 不存在"
ok "brain-ci-deploy.yml 存在"

# 2. push trigger + brain paths
grep -q "packages/brain/\*\*" "$WF" || err "未找到 brain paths filter"
ok "brain paths filter 存在"

# 3. concurrency group 独立（检查 group: 行，不检查注释）
grep -q "brain-autodeploy" "$WF" || err "concurrency group 不是 brain-autodeploy"
grep -E "^\s+group:\s+" "$WF" | grep -q "deploy-production" && err "group: 行不能是 deploy-production" || true
ok "concurrency group 正确 (brain-autodeploy)"

# 4. 409 skip logic
grep -q "409" "$WF" || err "缺少 409 skip 处理"
ok "409 处理存在"

# 5. Gate 2 Brain P0 任务创建
grep -q "api/brain/tasks" "$WF" || err "Gate 2 未调用 /api/brain/tasks"
ok "Gate 2 P0 任务创建存在"

# 6. cancel-in-progress: true
grep -q "cancel-in-progress: true" "$WF" || err "cancel-in-progress 未设置为 true"
ok "cancel-in-progress: true"

echo ""
echo "✅ Gate 3 + Gate 2 smoke 全部通过"
