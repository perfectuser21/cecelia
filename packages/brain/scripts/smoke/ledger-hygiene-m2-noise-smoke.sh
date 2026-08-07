#!/usr/bin/env bash
# ledger-hygiene-m2-noise-smoke.sh — m2「归属完整率」口径修正冒烟
# 守卫四根线不再断回去（sprint 08070516-relay-2c482ed6）：
#   ① 常量同源：LEDGER_SELF_ISSUE_PREFIX 运行时导出且逐字 '[ledger-hygiene]'
#   ② tasks 子查询排除守卫自产 [紧急] 前缀 task 与 payload.smoke_tag 冒烟 task
#   ③ issues 子查询排除自产前缀 issue（谓词在注释锚之后的外层 WHERE）
#   ④ attribution_harness 停计（ability_id 接线前不入和，消除双重计数）
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PASS=0; FAIL=0
ok()   { echo "  ✅ $1"; PASS=$((PASS+1)); }
bad()  { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

echo "── ledger-hygiene m2 口径修正 smoke ──"

# ① + ② + ③ + ④ 运行时验证：真实导入模块，stub pool 捕获 SQL 断言谓词与求和口径
if (cd "$ROOT" && node --input-type=module -e "
const m = await import('./src/ledger-hygiene.js');
if (m.LEDGER_SELF_ISSUE_PREFIX !== '[ledger-hygiene]') { console.error('常量漂移'); process.exit(1); }
const calls = [];
const pool = { query: async (sql) => { calls.push(sql);
  if (sql.includes('attribution_tasks')) return { rows: [{ total: '10', debt: '2' }] };
  if (sql.includes('attribution_issues')) return { rows: [{ total: '5', debt: '1' }] };
  return { rows: [] }; } };
const metrics = await m.computeMetrics(pool);
const t = calls.find((s) => s.includes('attribution_tasks'));
const i = calls.find((s) => s.includes('attribution_issues'));
if (!t.includes('smoke_tag')) { console.error('tasks 缺 smoke_tag 排除'); process.exit(1); }
if (!t.includes('[紧急] ' + m.LEDGER_SELF_ATOM_PREFIX)) { console.error('tasks 缺自产 [紧急] 排除'); process.exit(1); }
if (!i.includes(m.LEDGER_SELF_ISSUE_PREFIX)) { console.error('issues 缺自产前缀排除'); process.exit(1); }
if (t.indexOf('smoke_tag') < t.indexOf('attribution_tasks')) { console.error('tasks 谓词位置错（应在注释锚后外层 WHERE）'); process.exit(1); }
if (metrics.m2.debt !== 3) { console.error('m2 debt 口径错: ' + metrics.m2.debt + '（应 3，含 harness 双计则更大）'); process.exit(1); }
" ); then
  ok "运行时口径：常量同源 + 排除谓词入 SQL + harness 停计（debt=3）"
else
  bad "运行时口径验证失败"
fi

# 静态结构：注释锚保留 + 停计恢复注释存在
grep -q "attribution_tasks" "$ROOT/src/ledger-hygiene.js" && ok "attribution_tasks 注释锚保留" || bad "attribution_tasks 注释锚丢失"
grep -q "attribution_issues" "$ROOT/src/ledger-hygiene.js" && ok "attribution_issues 注释锚保留" || bad "attribution_issues 注释锚丢失"
grep -q "接线" "$ROOT/src/ledger-hygiene.js" && ok "harness 停计恢复注释（接线）存在" || bad "缺停计恢复注释"

# headed 派发冒烟脚本全部 harness_initiative 建 task 携带 smoke_tag（含 invalid-mode 防御性）
for f in codex-headed-dispatch-smoke.sh claude-headed-dispatch-smoke.sh; do
  if node -e "
const lines = require('fs').readFileSync('$ROOT/scripts/smoke/$f', 'utf8').split('\n')
  .filter((l) => l.includes('harness_initiative') && !l.includes('smoke_tag'));
process.exit(lines.length ? 1 : 0);
"; then
    ok "$f 建 task 全带 smoke_tag"
  else
    bad "$f 存在缺 smoke_tag 的建 task 行"
  fi
done

echo "PASS: $PASS  FAIL: $FAIL"
[[ $FAIL -eq 0 ]] || exit 1
