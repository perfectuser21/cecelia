#!/usr/bin/env bash
# line-context-smoke.sh — A-1 Context Manifest 真环境冒烟：
# 真 DB 调 fetchLineContext + formatLineContextForPrompt，用 Line04 真实数据
# （feature bb5b6a1f 五条铁律 + journey bfeed805）。
# 断言：① 输出含「不进群」 ② Invariant 段每行匹配 `- \[.+\] .+（来源: .+）`（E1 解析契约）。
# 本机（真数据存在）：纯只读。CI（cecelia_test 空库）：种最小夹具（同 ID）+ trap 清理，
# 与 journey-goldenpaths-invariants-smoke / handoff-smoke 的夹具纪律一致。
# 连接：优先 DATABASE_URL（CI real-env-smoke 提供，用户 cecelia）；无则本机默认 postgres。
set -euo pipefail
cd "$(dirname "$0")/../.."   # packages/brain

if [ -n "${DATABASE_URL:-}" ]; then
  PSQL="psql ${DATABASE_URL} -tA"
else
  export PGPASSWORD="${PGPASSWORD:-postgres}"
  PSQL="psql -h localhost -p 5432 -U postgres -d cecelia -tA"
fi
export SMOKE_DATABASE_URL="${DATABASE_URL:-}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

LINE04_ABILITY_ID="bb5b6a1f-ceb7-471c-9f89-6e1bcaf46e9a"
LINE04_JOURNEY_ID="bfeed805-deed-46c3-8624-87f0028101d4"
SEED_MARK="line-context-smoke 夹具"

SEEDED=0
cleanup() {
  if [ "$SEEDED" = "1" ]; then
    $PSQL -c "DELETE FROM decisions WHERE target_id='${LINE04_ABILITY_ID}' AND decision LIKE '%${SEED_MARK}%';" >/dev/null 2>&1 || true
    $PSQL -c "DELETE FROM journey_features WHERE id='${LINE04_ABILITY_ID}' AND name='line-context-smoke-ability';" >/dev/null 2>&1 || true
    $PSQL -c "DELETE FROM journeys WHERE id='${LINE04_JOURNEY_ID}' AND name='line-context-smoke-journey';" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

echo "[1/2] 数据存在性检查（本机真数据只读；CI 空库种最小夹具）"
HAVE=$($PSQL -c "SELECT COUNT(*) FROM decisions WHERE category='invariant' AND status='active' AND target_type='journey_feature' AND target_id='${LINE04_ABILITY_ID}';")
if [ "${HAVE:-0}" -eq 0 ]; then
  echo "  本库无 Line04 真实数据（CI test DB）→ 种同 ID 最小夹具，trap 清理"
  SEEDED=1
  $PSQL -c "INSERT INTO journeys (id, name) VALUES ('${LINE04_JOURNEY_ID}', 'line-context-smoke-journey') ON CONFLICT (id) DO NOTHING;" >/dev/null
  $PSQL -c "INSERT INTO journey_features (id, name, journey_id, kind, status) VALUES ('${LINE04_ABILITY_ID}', 'line-context-smoke-ability', '${LINE04_JOURNEY_ID}', 'ability', 'done') ON CONFLICT (id) DO NOTHING;" >/dev/null
  $PSQL -c "INSERT INTO decisions (category, topic, decision, level, target_type, target_id, status) VALUES ('invariant', '[Line04]不进群', '只私聊;群一律跳过（${SEED_MARK}）', 'ability', 'journey_feature', '${LINE04_ABILITY_ID}', 'active');" >/dev/null
else
  echo "  真实数据存在（invariants=${HAVE} 条）→ 纯只读"
fi

echo "[2/2] fetchLineContext + formatLineContextForPrompt"
node --input-type=module -e "
import { fetchLineContext, formatLineContextForPrompt, INVARIANT_SECTION_HEADER } from './src/harness-line-context.js';
import pg from 'pg';
const pool = process.env.SMOKE_DATABASE_URL
  ? new pg.Pool({ connectionString: process.env.SMOKE_DATABASE_URL })
  : new pg.Pool({ host: 'localhost', port: 5432, user: 'postgres', password: process.env.PGPASSWORD, database: 'cecelia' });
const ctx = await fetchLineContext({ pool }, {
  abilityId: '${LINE04_ABILITY_ID}',
  journeyId: '${LINE04_JOURNEY_ID}',
});
await pool.end();
const text = formatLineContextForPrompt(ctx);
console.log('--- 注入段输出 ---');
console.log(text);
console.log('--- 输出结束 ---');
if (!text.includes(INVARIANT_SECTION_HEADER)) { console.error('FAIL: 缺 Invariant 段头'); process.exit(1); }
if (!text.includes('不进群')) { console.error('FAIL: 输出不含「不进群」'); process.exit(1); }
// Invariant 段行格式契约（E1 解析用，与 planner Step 0.4 同构）
const invSection = text.split('\n\n').find(s => s.startsWith(INVARIANT_SECTION_HEADER)) || '';
const invLines = invSection.split('\n').filter(l => l.startsWith('- '));
if (invLines.length < 1) { console.error('FAIL: Invariant 段无条目'); process.exit(1); }
const re = /^- \[.+\] .+（来源: .+）\$/;
const bad = invLines.filter(l => !re.test(l));
if (bad.length) { console.error('FAIL: 行格式不匹配契约:\n' + bad.join('\n')); process.exit(1); }
console.log(\`OK: invariants=\${ctx.invariants.length} 条（格式行 \${invLines.length} 条全匹配契约），cumulativeFR=\${ctx.cumulativeFR.length} 个 ability\`);
"

echo "✅ line-context-smoke 全过"
