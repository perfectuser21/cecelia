#!/usr/bin/env bash
# CL-1 新增租户隔离规则(domain/tenant-no-isolation)冒烟:离线,纯 node,命中+不误伤+豁免三态
set -euo pipefail
cd "$(dirname "$0")/../.."   # packages/brain
PASS=0; FAIL=0
ok()   { echo "  ✅ $1"; ((PASS++)) || true; }
fail() { echo "  ❌ $1"; ((FAIL++)) || true; }

echo "── tenant-isolation rule smoke ──"
node --input-type=module -e "
import { evaluateContractText } from './src/lib/contract-gate.js';
const bad = 'Test: manual:psql -c \"SELECT * FROM tenant_accounts WHERE status=1\"';
const good = 'Test: manual:psql -c \"SELECT * FROM tenant_accounts WHERE tenant_id = 42 AND created_at > NOW() - INTERVAL \'1 hour\'\"';
const r1 = evaluateContractText(bad);
if (!r1.hits.some(h => h.ruleId === 'domain/tenant-no-isolation')) process.exit(1);
const r2 = evaluateContractText(good);
if (r2.hits.some(h => h.ruleId === 'domain/tenant-no-isolation' && !h.exempted)) process.exit(2);
" && ok "命中违规样本+不误伤合规样本" || fail "租户规则三态"

echo ""; echo "PASS: $PASS  FAIL: $FAIL"
[[ $FAIL -eq 0 ]] && echo "✅ 全部通过" || { echo "❌ 有 $FAIL 项失败"; exit 1; }
