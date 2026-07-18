#!/usr/bin/env bash
# orphan-guard-smoke.sh — 守卫补链刀验收(离线纯逻辑,CI 安全)
# [1] 自杀正则盖头号死因原句 [2] 收权分界:generator_done→noop [3] 主仓哨兵脚本语法
set -uo pipefail
PASS=0; FAIL=0
ok()   { echo "  ✅ $1"; PASS=$((PASS+1)); }
bad()  { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$ROOT"
echo "── orphan-guard-smoke ──"

if node --input-type=module -e "
import { WAIT_SUICIDE_PATTERN, handleRelayExitConsistency } from './packages/brain/src/lib/harness-orphan-guard.js';
if (!WAIT_SUICIDE_PATTERN.test('PR 已开出,等待 CI 结果通知。')) { console.error('正则漏头号死因'); process.exit(1); }
if (WAIT_SUICIDE_PATTERN.test('全部完成,PR 已合并')) { console.error('正则误伤正常结语'); process.exit(1); }
const pool = { query: async () => ({ rows: [{ id: 'aaaabbbb-0000-0000-0000-000000000000', status: 'in_progress', payload: { generator_done: true } }] }) };
const r = await handleRelayExitConsistency({ pool, execFn: () => '', containerId: 'cecelia-relay-aaaabbbb-x', exitCode: 0, resultText: '等 Monitor 通知' });
if (r.action !== 'noop') { console.error('收权分界失效: ' + r.action); process.exit(1); }
console.log('守卫逻辑 OK');
"; then ok "自杀正则+收权分界(generator_done→noop)"; else bad "守卫逻辑异常"; fi

if bash -n scripts/patrol/main-repo-sentinel.sh; then ok "主仓哨兵脚本语法"; else bad "哨兵语法错误"; fi

echo ""; echo "PASS: $PASS  FAIL: $FAIL"
if [ "$FAIL" -gt 0 ]; then echo "❌ 有 $FAIL 项失败"; exit 1; fi
echo "✅ 全部通过"
