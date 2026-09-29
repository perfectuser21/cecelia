#!/usr/bin/env bash
# skill-inventory-smoke — Skill 台账投影 PR1a（任务 47def5bb）CI 可跑冒烟：
# ① 迁移 491 列/CHECK/注册表改面 ② 远端采集程序经 node - 真跑（临时 HOME + 假 openclaw）
# ③ 扫描入账在测试库真跑一轮：present 入账、人管列不动、重跑 updated_at 不动。
# 「生产扫描 ok、present>0」属部署后验收，不在此处（CI 无 ssh mmv）。
set -euo pipefail
pass() { printf 'PASS: %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
: "${DATABASE_URL:?DATABASE_URL is required and must target a test or scratch database}"
PSQL="$(command -v psql)"; NODE="$(command -v node)"
DB_NAME="$("$NODE" -e "const u=new URL(process.argv[1]); process.stdout.write(decodeURIComponent(u.pathname.slice(1)))" "$DATABASE_URL")"
[[ "$DB_NAME" =~ (_test|_scratch)$ ]] || fail "refuse non-test db: ${DB_NAME:-empty}"
q() { "$PSQL" "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "$1"; }
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BRAIN_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
TAG="skinv-smoke-$$"
TMP_HOME="$(mktemp -d)"
cleanup() {
  q "DELETE FROM skill_registry WHERE name LIKE '${TAG}%'" >/dev/null 2>&1 || true
  q "DELETE FROM working_memory WHERE key IN ('skill_inventory_state','skill_manifest_drift')" >/dev/null 2>&1 || true
  rm -rf "$TMP_HOME"
}
trap cleanup EXIT
cleanup; TMP_HOME="$(mktemp -d)"

# ── 1. 迁移 491 ─────────────────────────────────────────
for col in platforms_installed presence absent_since source_kind content_md copies drift_copies tier_suggested \
           platforms_target openclaw_tier business_line owner category note notion_baseline notion_next_retry_at; do
  [[ "$(q "SELECT count(*) FROM information_schema.columns WHERE table_name='skill_registry' AND column_name='${col}'")" == "1" ]] \
    || fail "skill_registry 缺列 ${col}"
done
pass "迁移 491：机器列/人管列/系统列齐"
if q "INSERT INTO skill_registry (name, presence) VALUES ('${TAG}-bad','bogus')" >/dev/null 2>&1; then fail "presence CHECK 未生效"; fi
pass "迁移 491：presence CHECK 生效"
FACE="$(q "SELECT face||'/'||direction FROM notion_projection_map WHERE notion_db_id='353c40c2-ba63-81bf-ae3e-f0e6fa3753d7' AND brain_table='skill_registry'")"
[[ -z "$FACE" || "$FACE" == "inlet/both" ]] || fail "Skill Registry 注册表未改入口面：$FACE"
pass "迁移 491：Skill Registry 注册为 inlet/both"

# ── 2. 远端采集程序经 node - 真跑 ─────────────────────────
mkdir -p "$TMP_HOME/.claude/skills/${TAG}-a" "$TMP_HOME/.agents/skills" "$TMP_HOME/perfect21/zenithjoy-skills" "$TMP_HOME/.openclaw"
printf -- '---\ndescription: 冒烟\n---\n# a\n' > "$TMP_HOME/.claude/skills/${TAG}-a/SKILL.md"
echo '{"agents":{"entries":{}}}' > "$TMP_HOME/.openclaw/openclaw.json"
INV="$("$NODE" --input-type=module -e "
  import { buildRemoteProgram } from '${BRAIN_DIR}/src/lib/skill-inventory-remote.js';
  process.stdout.write(buildRemoteProgram({ home: process.argv[1] }));
" "$TMP_HOME" | "$NODE" -)"
echo "$INV" | grep -q '"ok":true' || fail "远端采集程序 node - 真跑失败: ${INV:0:300}"
echo "$INV" | grep -q "${TAG}-a"  || fail "采集结果缺 fixture skill"
pass "远端采集程序：自包含，经 node - 真跑输出合法清单"

# ── 3. 扫描入账真跑两轮 ───────────────────────────────────
q "INSERT INTO skill_registry (name, status, note) VALUES ('${TAG}-a','deprecated','人写的')" >/dev/null
RUN="
  import pg from 'pg';
  import { runSkillInventorySync } from '${BRAIN_DIR}/src/skill-inventory-sync.js';
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const inv = process.argv[1];
  const r = await runSkillInventorySync(pool, { force: true, inContainer: false, exec: async () => inv });
  console.log(JSON.stringify(r));
  await pool.end();
"
R1="$("$NODE" --input-type=module -e "$RUN" "$INV")"
echo "$R1" | grep -q '"ok":true' || fail "扫描入账失败: $R1"
ROW="$(q "SELECT presence||'|'||status||'|'||note||'|'||array_to_string(platforms_installed,',') FROM skill_registry WHERE name='${TAG}-a'")"
[[ "$ROW" == "present|deprecated|人写的|claude-code" ]] || fail "入账结果不对（应 present、人管列与 status 不动）：$ROW"
pass "扫描入账：present + 平台正确，status/人管列不动"
U1="$(q "SELECT updated_at FROM skill_registry WHERE name='${TAG}-a'")"
"$NODE" --input-type=module -e "$RUN" "$INV" >/dev/null
U2="$(q "SELECT updated_at FROM skill_registry WHERE name='${TAG}-a'")"
[[ "$U1" == "$U2" ]] || fail "内容没变却改了 updated_at（会让推送抖动）：$U1 → $U2"
pass "扫描入账：内容未变不动 updated_at"

echo "ALL PASS: skill-inventory"
