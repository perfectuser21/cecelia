#!/usr/bin/env bash
# 第三刀冒烟：4 条新规则存在且顺序正确（FK 先子后父）+ 收紧参数真实生效。
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$ROOT_DIR"
pass() { printf 'PASS: %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }

node --input-type=module -e "
import { SLIM_RULES } from './packages/brain/src/db-slim-rules.js';
const idx = (n) => SLIM_RULES.findIndex((r) => r.name === n);
const need = ['map_projection_edges_superseded','map_projection_nodes_superseded','map_projection_runs_superseded','harness_attempts_terminal_old'];
for (const n of need) if (idx(n) < 0) { console.error('缺规则 ' + n); process.exit(1); }
if (!(idx(need[0]) < idx(need[1]) && idx(need[1]) < idx(need[2]))) { console.error('投影三表删除顺序错（须 edges<nodes<runs）'); process.exit(1); }
const ev = SLIM_RULES.find((r) => r.name === 'cecelia_events_old');
if (!ev.deleteWhere.includes(\"'7 days'\")) { console.error('events 未收紧 7 天'); process.exit(1); }
const sm = SLIM_RULES.find((r) => r.name === 'memory_stream_selfmodel_history');
if (!sm.deleteWhere.includes('LIMIT 5')) { console.error('self_model 未收紧保 5 条'); process.exit(1); }
console.log('rules ok:', SLIM_RULES.length, '条');
" || fail "第三刀规则校验不符"
pass "4 条新规则存在、顺序正确、events 7d / self_model 保 5 生效"
echo "db-slim-knife3-smoke: ALL PASS"
