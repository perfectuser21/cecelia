#!/usr/bin/env bash
# validation-clock-fix-extension-smoke.sh
# 验证 r57：resolveValidationClock 按 spawn:generator-fix 轮有界顺延（上限 6 次）——
#   长跑 run 不再被固定首原点窗口误杀。纯 orchestrator 纯函数，真 import real 模块断言。
# Case 1: validation-clock.js 存在且硬编码顺延上限常量 VALIDATION_CLOCK_EXTENSION_LIMIT = 6
# Case 2: 2 轮 generator-fix → deadline 顺延到最新 fix 原点 created_at + timeout（忽略 stale detail）
# Case 3: 7 轮 generator-fix → 冻结在第 6 次顺延原点（防无限续命）
# Case 4: 恰好 6 轮 → 顺延到第 6 次原点（上限内不冻结）
# Case 5: 无 generator-fix 行 → 仍以首 generator 原点算（回归守恒）
# Case 6: 非 generator 系且无有效 origin → 仍抛 validation_clock_required（fail-closed 守恒）
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BRAIN_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
VCLOCK="$BRAIN_ROOT/src/orchestrator/validation-clock.js"

echo "[smoke:validation-clock-fix-extension] Case 1: 顺延上限常量硬编码"
node -e "const c=require('fs').readFileSync('$VCLOCK','utf8'); if(!/VALIDATION_CLOCK_EXTENSION_LIMIT\s*=\s*6\b/.test(c)) throw new Error('Case 1 FAIL: 缺 VALIDATION_CLOCK_EXTENSION_LIMIT=6'); console.log('  PASS: VALIDATION_CLOCK_EXTENSION_LIMIT=6 存在');"

echo "[smoke:validation-clock-fix-extension] Case 2-6: 真 import 断言有界顺延语义"
node --input-type=module -e "
import(process.argv[1]).then((m) => {
  const R = m.resolveValidationClock, T = 5400, T0 = Date.parse('2026-08-01T00:00:00.000Z');
  const iso = (s) => new Date(T0 + s * 1000).toISOString();
  const gen = (h, o, d) => ({ hop: h, action: 'spawn:generator', created_at: iso(o), ...(d ? { detail: d } : {}) });
  const fix = (h, o, d) => ({ hop: h, action: 'spawn:generator-fix', created_at: iso(o), ...(d ? { detail: d } : {}) });
  const eq = (name, got, exp) => { if (JSON.stringify(got) !== JSON.stringify(exp)) throw new Error(name + ' FAIL: got ' + JSON.stringify(got) + ' exp ' + JSON.stringify(exp)); console.log('  PASS: ' + name); };

  // Case 2: 2 轮 fix（最新 fix 携 stale detail 锚首原点）→ re-derive 到 fix2.created_at
  eq('Case2 2轮fix顺延到最新fix原点', R({ action: 'spawn:generator-fix', decisionLog: [gen(1, 0), fix(2, 5000), fix(3, 10000, { pipeline_started_at: iso(0), deadline_at: iso(T) })], intentAt: iso(12000), timeoutSeconds: T }), { pipeline_started_at: iso(10000), deadline_at: iso(10000 + T) });

  // Case 3: 7 轮 fix → 冻结第 6 次原点
  { const dl = [gen(1, 0)]; for (let k = 1; k <= 7; k += 1) dl.push(fix(1 + k, 1000 * k)); eq('Case3 7轮fix冻结第6次原点', R({ action: 'spawn:evaluator', decisionLog: dl, intentAt: iso(9000), timeoutSeconds: T }), { pipeline_started_at: iso(6000), deadline_at: iso(6000 + T) }); }

  // Case 4: 恰好 6 轮 → 第 6 次原点
  { const dl = [gen(1, 0)]; for (let k = 1; k <= 6; k += 1) dl.push(fix(1 + k, 1000 * k)); eq('Case4 恰好6轮顺延到第6次原点', R({ action: 'spawn:judge', decisionLog: dl, intentAt: iso(8000), timeoutSeconds: T }), { pipeline_started_at: iso(6000), deadline_at: iso(6000 + T) }); }

  // Case 5: 无 fix → 首原点（回归守恒）
  eq('Case5 无fix行仍首原点', R({ action: 'spawn:generator-fix', decisionLog: [gen(1, 0)], intentAt: iso(3000), timeoutSeconds: T }), { pipeline_started_at: iso(0), deadline_at: iso(T) });

  // Case 6: fail-closed 守恒
  let threw = false;
  try { R({ action: 'spawn:judge', decisionLog: [], intentAt: iso(0), timeoutSeconds: T }); } catch (e) { threw = e.message === 'validation_clock_required'; }
  if (!threw) throw new Error('Case6 FAIL: 未抛 validation_clock_required');
  console.log('  PASS: Case6 fail-closed 守恒');

  console.log('[smoke:validation-clock-fix-extension] ✅ 全部通过');
}).catch((e) => { console.error(String(e && e.message || e)); process.exit(1); });
" "$VCLOCK"
