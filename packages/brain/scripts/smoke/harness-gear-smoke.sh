#!/usr/bin/env bash
# smoke: harness-skill-relay.js deriveGear() + GEAR_VALUES 三档一体化契约
# 07-17 决策5：default(现行为)/hotfix(免GAN)/segmented(骨架点绿) 三档
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELAY_MODULE="${SCRIPT_DIR}/../../src/harness-skill-relay.js"

echo "[harness-gear-smoke] 验证 deriveGear() + GEAR_VALUES 契约..."

node -e "
import('${RELAY_MODULE}').then(m => {
  // Case 1: 缺省 payload → 'default'
  const g1 = m.deriveGear({});
  if (g1 !== 'default') { console.error('FAIL Case1: deriveGear({}) 期望 default，实得 ' + g1); process.exit(1); }
  console.log('  PASS Case1: deriveGear({}) === default');

  // Case 2: 显式 segmented 透传
  const g2 = m.deriveGear({ payload: { gear: 'segmented' } });
  if (g2 !== 'segmented') { console.error('FAIL Case2: deriveGear(segmented) 期望 segmented，实得 ' + g2); process.exit(1); }
  console.log('  PASS Case2: deriveGear(payload.gear=segmented) === segmented');

  // Case 3: 非法值必须 throw 且 message 含 invalid_gear
  let threw = false;
  try {
    m.deriveGear({ payload: { gear: 'bogus' } });
  } catch (e) {
    threw = true;
    if (!e.message.includes('invalid_gear')) {
      console.error('FAIL Case3: 异常 message 未含 invalid_gear，实得: ' + e.message);
      process.exit(1);
    }
  }
  if (!threw) { console.error('FAIL Case3: 非法 gear 值未抛出异常'); process.exit(1); }
  console.log('  PASS Case3: deriveGear(bogus) throw invalid_gear');

  // Case 4: GEAR_VALUES 长度必须为 3（default/hotfix/segmented）
  if (!Array.isArray(m.GEAR_VALUES) || m.GEAR_VALUES.length !== 3) {
    console.error('FAIL Case4: GEAR_VALUES 期望长度 3，实得: ' + JSON.stringify(m.GEAR_VALUES));
    process.exit(1);
  }
  console.log('  PASS Case4: GEAR_VALUES.length === 3 (' + m.GEAR_VALUES.join(',') + ')');

  console.log('[harness-gear-smoke] ✅ 全部通过');
}).catch(e => {
  console.error('FAIL: 模块加载或断言异常 — ' + e.stack);
  process.exit(1);
});
"
