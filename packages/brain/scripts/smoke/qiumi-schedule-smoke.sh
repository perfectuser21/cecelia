#!/usr/bin/env bash
# packages/brain/scripts/smoke/qiumi-schedule-smoke.sh
# Smoke: 秋米任务按「预期开始时间」排期派发（决策 51c09285，任务 0b3592c9）。
#   闸 1 时间归一：只写日期 → 当天 00:00 / 23:59:59 上海；中英镜像 Plan Date 写开始~结束区间 + 委派人。
#   闸 2 真库派发闸：payload.next_run_at 在未来的 queued 任务不进派发候选，已过的进（派发器谓词原样）。
# 只删自己插的行（title 前缀带 pid），绝不动别人的行。
set -euo pipefail
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }

: "${DATABASE_URL:?DATABASE_URL is required and must target a test or scratch database}"
DB_NAME="$(node -e "const u=new URL(process.argv[1]); process.stdout.write(decodeURIComponent(u.pathname.slice(1)))" "$DATABASE_URL")"
[[ "$DB_NAME" =~ (_test|_scratch)$ ]] || fail "拒绝连接非测试库: ${DB_NAME:-<empty>}"
# 闸 1 会 import 到 db.js 的模块级 Pool（只建不连）；对齐 DB_NAME，免得它指向默认库 cecelia。
export DB_NAME

cd "$(dirname "$0")/../.."

# ── 闸 1：时间归一 + 中英镜像 ────────────────────────────────────────────
node --input-type=module -e "
import { toStartIso, toEndIso, isFuture, scheduledNote } from './src/lib/qiumi-schedule.js';
import { parseZhPage, buildEnPageFromZh } from './src/notion-gtd-sync.js';
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) { console.error('FAIL', m, a, b); process.exit(1); } };
eq(toStartIso('2026-10-03'), '2026-10-03T00:00:00+08:00', '只写日期=当天 00:00 上海');
eq(toEndIso('2026-10-03'), '2026-10-03T23:59:59+08:00', '结束=当天 23:59:59 上海');
eq(isFuture('2999-01-01T00:00:00+08:00'), true, '未来');
eq(scheduledNote('2026-10-03T09:00:00.000Z'), '🕐 已排期 10-03 17:00，到点派发', '提示按上海时间');
const zh = parseZhPage({ id: '11111111-2222-3333-4444-555555555555', properties: {
  '预期开始时间': { date: { start: '2026-10-03T17:00:00+08:00' } },
  '预期结束时间': { date: { start: '2026-10-03T18:00:00+08:00' } },
  '委派人': { select: { name: 'media' } } } });
const p = buildEnPageFromZh(zh).properties;
eq(p['Plan Date'].date, { start: '2026-10-03T17:00:00+08:00', end: '2026-10-03T18:00:00+08:00' }, 'Plan Date 区间');
eq(p['Delegated By'].select.name, 'media', '委派人镜像');
console.log('✅ 闸 1 时间归一与镜像');
"

# ── 闸 2：真库里派发器的 next_run_at 谓词 ────────────────────────────────
TAG="qiumi-schedule-smoke-$$"
cleanup() { psql "$DATABASE_URL" -qtAc "DELETE FROM tasks WHERE title LIKE '${TAG}%'" >/dev/null 2>&1 || true; }
trap cleanup EXIT
psql "$DATABASE_URL" -qtAc "
  INSERT INTO tasks (title, task_type, status, priority, payload) VALUES
   ('${TAG}-future', 'qiumi_task', 'queued', 'P2', jsonb_build_object('next_run_at', (NOW() + interval '3 days')::text)),
   ('${TAG}-past',   'qiumi_task', 'queued', 'P2', jsonb_build_object('next_run_at', (NOW() - interval '1 hour')::text))" >/dev/null
PICKED="$(psql "$DATABASE_URL" -qtAc "
  SELECT string_agg(title, ',' ORDER BY title) FROM tasks t
   WHERE t.title LIKE '${TAG}%' AND t.status = 'queued'
     AND (t.payload->>'next_run_at' IS NULL OR t.payload->>'next_run_at' = ''
          OR (t.payload->>'next_run_at')::timestamptz <= NOW())")"
[[ "$PICKED" == "${TAG}-past" ]] || fail "派发候选应只有已到点的那条，实际: ${PICKED:-<空>}"
grep -q "(t.payload->>'next_run_at')::timestamptz <= NOW()" src/dispatch-helpers.js \
  || fail "派发器的 next_run_at 谓词不见了——排期将失效（委派即派）"
echo "✅ 闸 2 未到开始时间不派、到点可派"
