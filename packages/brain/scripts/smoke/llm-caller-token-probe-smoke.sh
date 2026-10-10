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
# anthropic 桥接路径（账号熔断 gate 所在）已随 Claude 无头通道退役（任务 76a160b3）：gate 不再存在时须有退役收口
node -e "const s=require('fs').readFileSync('$BRAIN/src/llm-caller.js','utf8');if(!s.includes('verifyAccountTokenLive')&&!s.includes('claude_channel_retired')&&!s.includes('ClaudeChannelRetired')){console.error('  ❌ gate 未接入 verifyAccountTokenLive，且无 claude_channel_retired 收口');process.exit(1)}console.log('  ✅ ok')"

echo "[smoke] 3. 无凭据账号 → unknown（不误熔断有效账号的关键保证）"
node -e "import('$BRAIN/src/account-usage.js').then(async m=>{const r=await m.verifyAccountTokenLive('__smoke_nonexistent__');if(r!=='unknown'){console.error('  ❌ 期望 unknown 实际 '+r);process.exit(1)}console.log('  ✅ ok='+r);process.exit(0)}).catch(e=>{console.error('  ❌ '+e.message);process.exit(1)})"

echo "[smoke] llm-caller-token-probe OK"
