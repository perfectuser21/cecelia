#!/usr/bin/env bash
# b39-triple-fix-smoke.sh
# 三联修复回归守卫：
#   Fix 1: brain-deploy.sh 扩展容器预清理状态 + 限定 node-brain 服务
#   Fix 2: executor.js syncOrphanTasksOnStartup harness_initiative 任务重入队携带 resume_from_checkpoint
#   Fix 3: harness-initiative.graph.js parsePrdNode B39 — LLM 提取的 sprint_dir 不存在时回退 payload 原值
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BRAIN_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$BRAIN_ROOT"

# ── Fix 1: brain-deploy.sh 五状态清理 + node-brain 限定 ──────────────────────
echo "[smoke:b39] Fix 1: brain-deploy.sh 扩展容器预清理"

DEPLOY_SH="$BRAIN_ROOT/../../scripts/brain-deploy.sh"
if [ ! -f "$DEPLOY_SH" ]; then
  # monorepo 根的 scripts/ 路径
  DEPLOY_SH="$(cd "$BRAIN_ROOT/../.." && pwd)/scripts/brain-deploy.sh"
fi

if ! grep -qE 'for _ctr_status in exited created paused restarting dead' "$DEPLOY_SH"; then
  echo "[smoke:b39] FAIL Fix 1: brain-deploy.sh 未覆盖五种容器状态 (exited/created/paused/restarting/dead)"
  exit 1
fi
echo "  ✓ 五种容器状态均已覆盖 (exited/created/paused/restarting/dead)"

if ! grep -qE 'docker compose.*up.*-d node-brain' "$DEPLOY_SH"; then
  echo "[smoke:b39] FAIL Fix 1: docker compose up 未限定 node-brain 服务"
  exit 1
fi
echo "  ✓ docker compose up 已限定 node-brain 服务"

echo "[smoke:b39] Fix 1 PASS"

# ── Fix 2: executor.js syncOrphanTasksOnStartup task_type + resume_from_checkpoint ──
echo "[smoke:b39] Fix 2: executor.js harness_initiative 重入队携带 resume_from_checkpoint"

node --input-type=module << 'JS'
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const src = await readFile(
  path.join(process.cwd(), 'src/executor.js'),
  'utf8'
);

// 验证 syncOrphanTasksOnStartup SELECT 含 task_type
const selectBlock = src.match(/syncOrphanTasksOnStartup[\s\S]{0,2000}SELECT[^;]+;/);
if (!selectBlock) throw new Error('Fix 2 FAIL: 找不到 syncOrphanTasksOnStartup 中的 SELECT 语句');
if (!selectBlock[0].includes('task_type')) {
  throw new Error('Fix 2 FAIL: syncOrphanTasksOnStartup SELECT 未包含 task_type 字段');
}
console.log('  ✓ syncOrphanTasksOnStartup SELECT 含 task_type');

// 验证 harness_initiative 分支设置 resume_from_checkpoint
if (!src.includes("task.task_type === 'harness_initiative'") ||
    !src.includes('resume_from_checkpoint = true')) {
  throw new Error('Fix 2 FAIL: syncOrphanTasksOnStartup 未为 harness_initiative 设置 resume_from_checkpoint=true');
}
console.log('  ✓ harness_initiative 重入队设置 resume_from_checkpoint=true');

console.log('[smoke:b39] Fix 2 PASS');
JS

# ── Fix 3: parsePrdNode B39 — LLM sprint_dir 不存在时回退 payload 值 ─────────
echo "[smoke:b39] Fix 3: parsePrdNode B39 sprint_dir 回退逻辑"

node --input-type=module << 'JS'
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const src = await readFile(
  path.join(process.cwd(), 'src/workflows/harness-initiative.graph.js'),
  'utf8'
);

// 验证 B39 标记存在
if (!src.includes('B39')) {
  throw new Error('Fix 3 FAIL: harness-initiative.graph.js 中找不到 B39 标记');
}
console.log('  ✓ B39 标记存在');

// 验证 access() 调用
if (!src.includes('await access(path.join(state.worktreePath, sprintDir))')) {
  throw new Error('Fix 3 FAIL: B39 未调用 access() 验证目录存在性');
}
console.log('  ✓ access() 目录存在性校验已实现');

// 验证回退逻辑
if (!src.includes("sprint_dir || 'sprints'") || !src.includes('sprintDir = payloadDir')) {
  throw new Error('Fix 3 FAIL: B39 缺少回退到 payload sprint_dir 的逻辑');
}
console.log('  ✓ 回退到 payload.sprint_dir 逻辑已实现');

console.log('[smoke:b39] Fix 3 PASS');
JS

echo "✅ [smoke:b39] All 3 fixes verified (deploy-states + resume-checkpoint + sprint_dir-fallback)"
exit 0
