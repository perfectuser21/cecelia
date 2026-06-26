#!/usr/bin/env bash
# llm-caller-token-probe-smoke.sh
# post-deploy 真环境验证：llm-caller 熔断前 token 探测能力就位。
# 验证 (1) verifyAccountTokenLive 已导出 (2) llm-caller gate 已接入探测
# (3) 对无凭据账号返回 'unknown'（不抛错、不误熔断 —— 这正是修复要保证的行为）。
set -euo pipefail

BRAIN="$(cd "$(dirname "$0")/../.." && pwd)"
echo "[smoke] llm-caller token 探测 — BRAIN=$BRAIN"

echo "[smoke] 1. verifyAccountTokenLive 已导出"
node -e "import('$BRAIN/src/account-usage.js').then(m=>{if(typeof m.verifyAccountTokenLive!=='function'){console.error('  ❌ verifyAccountTokenLive 未导出');process.exit(1)}console.log('  ✅ ok');process.exit(0)}).catch(e=>{console.error('  ❌ '+e.message);process.exit(1)})"

echo "[smoke] 2. llm-caller gate 已接入探测"
node -e "const s=require('fs').readFileSync('$BRAIN/src/llm-caller.js','utf8');if(!s.includes('verifyAccountTokenLive')){console.error('  ❌ gate 未接入 verifyAccountTokenLive');process.exit(1)}console.log('  ✅ ok')"

echo "[smoke] 3. 无凭据账号 → unknown（不误熔断有效账号的关键保证）"
node -e "import('$BRAIN/src/account-usage.js').then(async m=>{const r=await m.verifyAccountTokenLive('__smoke_nonexistent__');if(r!=='unknown'){console.error('  ❌ 期望 unknown 实际 '+r);process.exit(1)}console.log('  ✅ ok='+r);process.exit(0)}).catch(e=>{console.error('  ❌ '+e.message);process.exit(1)})"

echo "[smoke] llm-caller-token-probe OK"
