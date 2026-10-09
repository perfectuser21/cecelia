#!/usr/bin/env bash
# Smoke: skill-dist-drift — skill 分发清单/漂移检测/同步脚本（链 bf5088a3 棒8，任务 1141f101）
# 验证（全程本地临时目录 + 注入假执行器，不发 ssh）：
#   1. 清单脚本：同内容不同 mtime 哈希相同；改一个字节该 skill 与 tree_hash 变；悬空符号链接进 broken 不进 tree_hash
#   2. 漂移检测：改一个 skill → drift；ssh 失败 → unreachable 且不产生 missing（不当零个 skill）
#   3. 渲染：漂移 → 晨报 🟡 AMBER；一致 → 无行
#   4. 接线：scheduler 注册 skill-dist-drift；晨报/日报接 skill-dist-report；同步脚本默认 dry-run 且 rsync -L
set -euo pipefail
cd "$(dirname "$0")/../.."

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "[skill-dist-drift-smoke] 1. 清单脚本确定性"
mkdir -p "$TMP/skills/alpha" "$TMP/skills/beta"
echo "# alpha" > "$TMP/skills/alpha/SKILL.md"
echo "# beta" > "$TMP/skills/beta/SKILL.md"
a="$(bash ../../scripts/skill-manifest.sh "$TMP/skills")"
touch -t 200101010000 "$TMP/skills/alpha/SKILL.md"
b="$(bash ../../scripts/skill-manifest.sh "$TMP/skills")"
ha="$(printf '%s' "$a" | sed -n 's/.*"tree_hash":"\([0-9a-f]*\)".*/\1/p')"
hb="$(printf '%s' "$b" | sed -n 's/.*"tree_hash":"\([0-9a-f]*\)".*/\1/p')"
[ -n "$ha" ] && [ "$ha" = "$hb" ] || { echo "FAIL 同内容不同 mtime 哈希应相同: $ha vs $hb"; exit 1; }
echo "# alpha!" > "$TMP/skills/alpha/SKILL.md"
c="$(bash ../../scripts/skill-manifest.sh "$TMP/skills")"
hc="$(printf '%s' "$c" | sed -n 's/.*"tree_hash":"\([0-9a-f]*\)".*/\1/p')"
[ "$hc" != "$ha" ] || { echo "FAIL 改一个字节 tree_hash 应变化"; exit 1; }
ln -s /nonexistent/zzz "$TMP/skills/zzz"
d="$(bash ../../scripts/skill-manifest.sh "$TMP/skills")"
printf '%s' "$d" | grep -q '"broken":\["zzz"\]' || { echo "FAIL 悬空链接应进 broken: $d"; exit 1; }
hd="$(printf '%s' "$d" | sed -n 's/.*"tree_hash":"\([0-9a-f]*\)".*/\1/p')"
[ "$hd" = "$hc" ] || { echo "FAIL 悬空链接不应污染 tree_hash"; exit 1; }
echo "mtime 无关 / 改一字节即变 / 悬空单列 ✓"

echo "[skill-dist-drift-smoke] 2-3. 漂移检测 + unreachable 不当零个 + 渲染"
node --input-type=module -e "
import { treeHashOf } from './src/lib/skill-manifest.js';
import { runSkillDistDrift } from './src/skill-dist-drift.js';
import { renderSkillDistLine } from './src/lib/skill-dist-report.js';
const H = (c) => c.repeat(64);
const truth = { a: H('1'), b: H('2') };
const mj = (skills) => JSON.stringify({ version: 1, dir: '/x', host: 'h', count: Object.keys(skills).length, skills, broken: [], tree_hash: treeHashOf(skills) });
const store = new Map();
const pool = { query: async (sql, p = []) => {
  if (/INSERT/.test(sql)) { store.set(p[0], JSON.parse(p[1])); return { rows: [] }; }
  return { rows: store.has(p[0]) ? [{ value_json: store.get(p[0]) }] : [] };
} };
const mk = (m4, m1) => async (cmd) => {
  const host = cmd.includes('xian-m4') ? 'm4' : cmd.includes('xian-m1') ? 'm1' : 'truth';
  const v = { truth, m4, m1 }[host];
  if (v instanceof Error) throw v;
  return mj(v);
};
const key = () => [...store.values()][0];
await runSkillDistDrift(pool, { force: true, inContainer: false, scriptText: 'x', runners: ['xian-m4', 'xian-m1'], exec: mk({ ...truth, b: H('9') }, truth) });
let st = key();
if (st.machines[0].dirs[0].status !== 'drift' || st.machines[0].dirs[0].changed[0] !== 'b') { console.error('FAIL 改一个 skill 应检出 drift'); process.exit(1); }
if (!/AMBER/.test(renderSkillDistLine(st) || '')) { console.error('FAIL 漂移应出 AMBER 行'); process.exit(1); }
store.clear();
await runSkillDistDrift(pool, { force: true, inContainer: false, scriptText: 'x', runners: ['xian-m4', 'xian-m1'], exec: mk(truth, new Error('ssh: connect refused')) });
st = key();
const m1 = st.machines[1].dirs[0];
if (m1.status !== 'unreachable' || (m1.missing || []).length || st.summary.drifted.length) { console.error('FAIL ssh 失败应标 unreachable 且不产生 missing: ' + JSON.stringify(m1)); process.exit(1); }
store.clear();
await runSkillDistDrift(pool, { force: true, inContainer: false, scriptText: 'x', runners: ['xian-m4', 'xian-m1'], exec: mk(truth, truth) });
if (renderSkillDistLine(key()) !== null) { console.error('FAIL 一致不应出行'); process.exit(1); }
console.log('drift 检出 / unreachable 不当零个 / 一致无行 ✓');
"

echo "[skill-dist-drift-smoke] 4. 接线"
node -e "
const fs = require('fs');
const checks = [
  ['src/scheduler-jobs.js', [\"name: 'skill-dist-drift'\", 'runSkillDistDrift(pool)']],
  ['src/daily-report-generator.js', ['readSkillDistState(dbPool)', 'renderSkillDistSection']],
  ['src/morning-cockpit-bark.js', ['fetchSkillDistLine', 'renderSkillDistLine']],
  ['../../scripts/skill-sync-to-runners.sh', ['rsync -azL', '模式=\$MODE', 'MODE=\"dry-run\"']],
];
let fail = false;
for (const [file, needles] of checks) {
  const src = fs.readFileSync(file, 'utf8');
  for (const n of needles) if (!src.includes(n)) { console.error('FAIL ' + file + ' 缺少: ' + n); fail = true; }
}
if (fail) process.exit(1);
console.log('scheduler / 日报 / 晨报 / 同步脚本 全部接线 ✓');
"

echo "[skill-dist-drift-smoke] PASS"
