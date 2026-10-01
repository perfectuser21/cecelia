#!/usr/bin/env bash
# packages/brain/scripts/smoke/phone-registry-smoke.sh
# Smoke: 手机台账 phone_registry + 秋米路由按台账定手机（任务 b923b1f7，决策 432172f7 方案 C）
#   1. 迁移 490 种子（四台）喂给 resolvePhone：0929 事故原文「小黄手机」「小彩手机（型号 MAA-AN00）」唯一定案；
#      只写型号不定案；disabled 不命中；定不下提示里的昵称来自台账
#   2. 有库（DATABASE_URL/PG*）时：phone_registry 真表有 4 台种子，按真表行再解析一次
#   3. 有 Brain（BRAIN_URL）时：GET /api/brain/phone-registry 返回 ≥4 行且含小黄；PUT 空 body 不得 200（不写库）
#      （无令牌 401 由单测钉住：CI 容器 host 网络 + 未配 token 时 loopback 放行，这里测不出来）
set -euo pipefail

# 真 Brain 写入必须显式授权，并核对本机测试容器。
if ! node "$(dirname "${BASH_SOURCE[0]}")/../lib/smoke-production-guard.mjs" "${BRAIN_URL:-http://localhost:5221}" "${DATABASE_URL:---pg-env}"; then
  exit 0
fi
cd "$(dirname "$0")/../.."

ROWS_JSON=""
if command -v psql >/dev/null 2>&1 && { [ -n "${DATABASE_URL:-}" ] || [ -n "${PGDATABASE:-}" ]; }; then
  echo "[phone-registry-smoke] 2. 真库 phone_registry 种子"
  ROWS_JSON=$(psql ${DATABASE_URL:+"$DATABASE_URL"} -v ON_ERROR_STOP=1 -Atc \
    "SELECT COALESCE(json_agg(row_to_json(p) ORDER BY serial), '[]') FROM phone_registry p" 2>/dev/null || echo "")
  if [ -n "$ROWS_JSON" ]; then
    N=$(node -e "console.log(JSON.parse(process.argv[1]).length)" "$ROWS_JSON")
    if [ "$N" -lt 4 ]; then echo "FAIL phone_registry 只有 $N 行（种子应为 4）"; exit 1; fi
    echo "phone_registry $N 行 ✓"
  else
    echo "（库里没有 phone_registry 表或连不上，跳过真库段；迁移未跑时路由会回退 device_locks）"
  fi
fi

echo "[phone-registry-smoke] 1. 种子行 → resolvePhone"
ROWS_JSON="$ROWS_JSON" node --input-type=module -e "
import { readFileSync } from 'node:fs';
import { resolvePhone, unresolvedNote } from './src/routing/phone-resolver.js';
let rows = process.env.ROWS_JSON ? JSON.parse(process.env.ROWS_JSON) : null;
if (!rows || !rows.length) {
  // 没有库：从迁移 490 的种子里抽四台（与生产种子同源，不另抄一份）
  const sql = readFileSync('./migrations/490_phone_registry.sql', 'utf8');
  const re = /\('([^']+)', '([^']+)', ARRAY\[([^\]]*)\], '([^']+)', '([^']+)', '([^']+)', '[^']+', '[^']+',\s*'(\[[^']*\])'::jsonb/g;
  rows = [...sql.matchAll(re)].map((m) => ({
    serial: m[1], nickname: m[2], aliases: [...m[3].matchAll(/'([^']+)'/g)].map((x) => x[1]),
    host: m[4], profile: m[5], model: m[6], douyin_accounts: JSON.parse(m[7]), enabled: true,
  }));
}
if (rows.length < 4) { console.error('FAIL 种子行不足 4 台: ' + rows.length); process.exit(1); }
let bad = 0;
const want = (text, serial) => {
  const r = resolvePhone(text, rows);
  if (r.status !== 'unique' || r.phone.serial !== serial) { console.error('FAIL', text, '→', JSON.stringify({ status: r.status, serial: r.phone?.serial })); bad += 1; }
  else console.log('PASS', text, '→', r.phone.nickname, r.phone.serial, r.matchedBy);
};
want('设备：小黄手机\n给最新视频点赞', 'ANGYVB4402004137');
want('用小彩手机（型号 MAA-AN00）发一条抖音', 'ANGYVB4311010223');
want('二号机上发作品', 'e6c7ef34');
want('抖音号 langzi63485 回复私信', 'ANGYVB4227006983');
const amb = resolvePhone('用型号 MAA-AN00 的手机点赞', rows);
if (amb.status !== 'ambiguous') { console.error('FAIL 只写型号不该定案'); bad += 1; } else console.log('PASS 只写型号 → ambiguous，候选', amb.candidates.length, '台');
const off = rows.map((r) => (r.nickname === '小黄' ? { ...r, enabled: false } : r));
if (resolvePhone('用小黄手机点赞', off).status !== 'none') { console.error('FAIL disabled 行不该命中'); bad += 1; } else console.log('PASS disabled 不命中');
const note = unresolvedNote(rows);
if (!['小彩', '小白', '小黄', '小蓝'].every((n) => note.includes(n))) { console.error('FAIL 提示缺昵称: ' + note); bad += 1; } else console.log('PASS 提示:', note);
process.exit(bad ? 1 : 0);
"

if [ -n "${BRAIN_URL:-}" ] && curl -q -sf -m 5 "$BRAIN_URL/api/brain/tick/status" >/dev/null 2>&1; then
  echo "[phone-registry-smoke] 3. Brain 路由"
  BODY=$(curl -q -sf -m 10 "$BRAIN_URL/api/brain/phone-registry")
  node -e "
const b = JSON.parse(process.argv[1]);
if (!(b.count >= 4) || !b.phones.some((p) => p.serial === 'ANGYVB4402004137' && p.nickname === '小黄')) { console.error('FAIL GET 返回', b.count); process.exit(1); }
console.log('GET /phone-registry', b.count, '行 ✓');
" "$BODY"
  CODE=$(curl -q -s -o /dev/null -w '%{http_code}' -m 10 -X PUT -H 'Content-Type: application/json' \
    -d '{}' "$BRAIN_URL/api/brain/phone-registry/SMOKE0000")
  case "$CODE" in 400|401|503) echo "PUT 空 body → $CODE（未写库）✓" ;; *) echo "FAIL PUT 空 body 返回 $CODE"; exit 1 ;; esac
fi
echo "[phone-registry-smoke] ✅ 全部通过"
