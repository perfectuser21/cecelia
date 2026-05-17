#!/usr/bin/env bash
# Consciousness guard SSOT check
# 保证所有意识开关判断都通过 isConsciousnessEnabled() 获取，禁止裸读环境变量
# 例外：packages/brain/src/consciousness-guard.js 本身 + 测试文件

set -euo pipefail

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Consciousness Guard SSOT Check"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

OFFENDERS=$(grep -rnE "process\.env\.(BRAIN_QUIET_MODE|CONSCIOUSNESS_ENABLED)" \
  packages/brain/src/ packages/brain/server.js 2>/dev/null \
  | grep -v "consciousness-guard.js" \
  | grep -v "__tests__/" \
  || true)

if [[ -n "$OFFENDERS" ]]; then
  echo "❌ 发现裸读意识开关环境变量，必须通过 isConsciousnessEnabled() 获取："
  echo ""
  echo "$OFFENDERS"
  echo ""
  echo "修复方式："
  echo "  import { isConsciousnessEnabled } from './consciousness-guard.js';"
  echo "  if (isConsciousnessEnabled()) { ... }"
  exit 1
fi

echo "✅ 无裸读，所有意识开关判断通过 isConsciousnessEnabled()"
