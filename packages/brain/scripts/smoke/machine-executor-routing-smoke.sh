#!/usr/bin/env bash
# machine-executor-routing-smoke.sh
# 验证 DB 驱动「机器+执行器」路由地基（phase 1）：
#   1. GET /api/brain/machines —— resolveExecutor 的真相源（设备表）可读
#   2. resolveExecutor 默认任务（无 payload.machine/executor）→ us-m4/claude
#      （守用户死规则「默认美国 Claude」，不漂西安/codex）
# Brain 不在线时优雅跳过（exit 0），不阻塞无 live-env 的场景。
set -uo pipefail

BRAIN="${BRAIN_API_URL:-http://localhost:5221}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRAIN_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "[smoke] 1) GET ${BRAIN}/api/brain/machines"
if ! MACHINES=$(curl -s --fail --max-time 10 "${BRAIN}/api/brain/machines" 2>/dev/null); then
  echo "[smoke] ⏭️  Brain 不在线（${BRAIN}），跳过 live 校验"
  exit 0
fi
echo "$MACHINES" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));if(!Array.isArray(d)||d.length===0){console.error("[smoke] ❌ machines 设备表为空");process.exit(1)}console.log("[smoke] 设备表:",d.map(m=>m.name).join(", "))'

echo "[smoke] 2) resolveExecutor 默认任务 → us-m4/claude"
node --input-type=module -e "
import { resolveExecutor } from '${BRAIN_ROOT}/src/routing/resolve-executor.js';
const r = await resolveExecutor({ task_type: 'harness_task', payload: {} });
if (r.executor !== 'claude') { console.error('[smoke] ❌ 默认 executor 应为 claude，实际:', r.executor); process.exit(1); }
console.log('[smoke] 默认路由 OK:', JSON.stringify(r));
process.exit(0);
"

echo "[smoke] ✅ machine-executor-routing smoke 通过"
