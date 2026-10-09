#!/usr/bin/env bash
# capability-gate-smoke.sh — Crystal 件6 冒烟(零外部依赖):
# 非 new_capability 放行 / reject 即 fail-closed / 契约不全即拒。
set -euo pipefail
cd "$(dirname "$0")/../.."

node --input-type=module -e "
import { runCapabilityGate } from './src/capability-gate.js';
const db = { query: async () => ({ rows: [] }) };

// ① 非 new_capability:放行不裁决
const r1 = await runCapabilityGate(db, { changeKind: 'bugfix', request: {}, adjudicate: async () => { throw new Error('不该被调'); } });
if (r1.triggered !== false || r1.released !== true) { console.error('FAIL: 非新能力未直放行', r1); process.exit(1); }

// ② reject → fail-closed
try {
  await runCapabilityGate(db, { changeKind: 'new_capability', request: {}, adjudicate: async () => ({ decision: 'reject' }) });
  console.error('FAIL: reject 未抛'); process.exit(1);
} catch (e) { if (e.code !== 'capability_gate_rejected') { console.error('FAIL: 异常码', e.code); process.exit(1); } }

// ③ pass 但 NFR 三数不全 → 契约不完整拒
try {
  await runCapabilityGate(db, { changeKind: 'new_capability', request: {}, adjudicate: async () => ({ decision: 'pass', postcondition: 'x', nfr: { cost_ceiling: 1 } }) });
  console.error('FAIL: 契约不全未抛'); process.exit(1);
} catch (e) { if (e.code !== 'capability_gate_contract_incomplete') { console.error('FAIL: 异常码', e.code); process.exit(1); } }

console.log('✅ capability-gate smoke 通过(直放行/fail-closed/契约完整性)');
"
