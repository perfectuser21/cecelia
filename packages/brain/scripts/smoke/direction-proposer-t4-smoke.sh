#!/usr/bin/env bash
# direction-proposer-t4-smoke.sh
# GP4/T4 smoke：强制窗口内跑一次主入口（注入假 LLM），验证 golden_paths 出 candidate + working_memory 出 gp_gap_panorama（DoD F11）
set -uo pipefail

DB="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"
PASS=0; FAIL=0
ok()   { echo "✅ $1"; PASS=$((PASS+1)); }
fail() { echo "❌ $1"; FAIL=$((FAIL+1)); }

if ! command -v psql >/dev/null 2>&1 || ! psql "$DB" -tAc "SELECT 1" >/dev/null 2>&1; then
  echo "[smoke] SKIP: DB 不可达"; exit 0
fi

# 强制窗口时刻（2026-07-12 是周日，UTC 21:31）+ 注入假 LLM，直接调主入口
cd "$(dirname "$0")/../.." || exit 1
OUT=$(DATABASE_URL="$DB" node --input-type=module -e "
import pg from 'pg';
import { maybeRunDirectionProposer } from './src/direction-proposer.js';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const fakeLlm = async () => ({ text: JSON.stringify({ candidates: [{ title: 'smoke GP T4', one_liner: 'smoke 用例', kr_id: null, journey_id: null, est_scale: '烟测' }] }) });
const r = await maybeRunDirectionProposer(pool, { now: new Date(Date.UTC(2026, 6, 12, 21, 31)), llm: fakeLlm });
console.log(JSON.stringify(r));
await pool.end();
" 2>&1)
echo "[smoke] 主入口返回: $OUT"

echo "$OUT" | grep -q '"triggered":true' && ok "主入口窗口内触发" || fail "主入口未触发: $OUT"

# 去重哨兵存在（skipped 或首跑都会留下/依赖 panorama）
psql "$DB" -tAc "SELECT 1 FROM working_memory WHERE key='gp_gap_panorama'" | grep -q 1 \
  && ok "working_memory 有 gp_gap_panorama 全景" || fail "缺 gp_gap_panorama"

# 首跑会写 candidate；20h 内重跑 skipped 也算通过（幂等即设计）
if echo "$OUT" | grep -q '"skipped":true'; then
  ok "20h 去重生效（重跑 skip）"
else
  psql "$DB" -tAc "SELECT 1 FROM golden_paths WHERE title='smoke GP T4' AND source='strategist'" | grep -q 1 \
    && ok "golden_paths 出 strategist candidate" || fail "candidate 未写入"
  # 清理烟测数据 + 哨兵回拨：smoke 首跑刷新了 gp_gap_panorama 的 updated_at，
  # 不回拨会让 20h 去重吞掉最近一个真实周一窗口的方向菜单
  psql "$DB" -tAc "DELETE FROM golden_paths WHERE title='smoke GP T4'" >/dev/null 2>&1
  psql "$DB" -tAc "UPDATE working_memory SET updated_at = NOW() - INTERVAL '21 hours' WHERE key='gp_gap_panorama'" >/dev/null 2>&1
fi

echo "── smoke 结果: PASS=$PASS FAIL=$FAIL ──"
[[ $FAIL -eq 0 ]] || exit 1
