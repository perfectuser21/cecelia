#!/usr/bin/env bash
# Smoke: preview-capacity-gate-and-destroyer（task 1b1f1ffa）
# 覆盖：历史资源统一销毁器（destroyPreview）
# + migration 358 + 销毁器禁本地 df/diskutil 调用；旧PR创建准入已退役。
#
# 需要真实 Postgres（cecelia_test，NODE_ENV=test）——与本 sprint 合同"禁 mock 边"要求一致，
# 不 mock DB 层。不依赖 Brain HTTP 服务（BRAIN_URL），纯结构 + 真实 DB 功能验证，
# 可在任意环境（本地/CI）安全跑，不触碰共享的生产 Brain 容器。
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
cd "$ROOT_DIR"

export NODE_ENV="${NODE_ENV:-test}"
export DB_NAME="${DB_NAME:-cecelia_test}"

# ── 1. ARTIFACT：文件存在 + 导出 ─────────────────────────────────────────────
[ -f "packages/brain/src/preview-destroyer.js" ] || { echo "FAIL: preview-destroyer.js 不存在"; exit 1; }
grep -q "destroyPreview" packages/brain/src/preview-destroyer.js || { echo "FAIL: destroyPreview 未导出"; exit 1; }
echo "OK: preview-destroyer.js 存在且导出 destroyPreview"

MIGRATION_358=$(find packages/brain/migrations -maxdepth 1 -name "358_*.sql" | head -1)
[ -n "$MIGRATION_358" ] || { echo "FAIL: migration 358 不存在"; exit 1; }
grep -q "cleaning" "$MIGRATION_358" && grep -q "cleanup_failed" "$MIGRATION_358" && grep -q "cleanup_detail" "$MIGRATION_358" \
  || { echo "FAIL: migration 358 缺 cleaning/cleanup_failed/cleanup_detail"; exit 1; }
echo "OK: migration 358 存在且含 cleaning/cleanup_failed/cleanup_detail"

grep -q "preview-destroyer" scripts/preview-cleanup.sh || { echo "FAIL: preview-cleanup.sh 未重写为 preview-destroyer 执行体"; exit 1; }
echo "OK: preview-cleanup.sh 已重写为 preview-destroyer.js 执行体"

# ── 2. T10：preview-destroyer.js 内禁本地 df/diskutil 直接调用 ──
node -e "
const fs=require('fs');
const files=['packages/brain/src/preview-destroyer.js'];
const bad=/execSync\(\s*['\"\`]\s*df\b|spawnSync\(\s*['\"\`]df['\"\`]|spawn\(\s*['\"\`]df['\"\`]|exec\(\s*['\"\`]\s*df\b|['\"\`]diskutil['\"\`]|\bdf\s+-k\b/;
let fail=false;
for (const f of files) {
  const c=fs.readFileSync(f,'utf8');
  if (bad.test(c)) { console.error('FAIL: ' + f + ' 内含本地 df/diskutil 直接调用'); fail=true; }
}
if (fail) process.exit(1);
console.log('OK: no local df/diskutil calls in preview-destroyer.js');
"

# ── 5. 功能验证：destroyPreview 幂等（对不存在/inactive 的 PR 调用应安全返回）──
node --input-type=module -e "
import { destroyPreview } from './packages/brain/src/preview-destroyer.js';
import pool from './packages/brain/src/db.js';

const smokePr = 971000 + Math.floor(Math.random() * 9000);
const r = await destroyPreview(smokePr, 'smoke', 'smoke-exec-' + Date.now(), pool, {});
if (r.destroyed !== true || r.status !== 'inactive') {
  console.error('FAIL: destroyPreview 对不存在的 PR 应幂等返回 destroyed:true/status:inactive', r);
  process.exit(1);
}
console.log('OK: destroyPreview 对不存在的 PR 幂等安全返回');
await pool.end();
"

echo ""
echo "✅ preview-capacity-gate-and-destroyer smoke 全部通过"
