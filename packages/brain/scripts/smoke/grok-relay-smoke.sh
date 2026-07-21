#!/usr/bin/env bash
# grok-relay-smoke.sh
# 验证 harness relay grok executor 收编（TASK_ID: a598772e）
# Case 1: isGrok 分支在 spawnSkillRelaySession 中正确识别
# Case 2: GROK_RELAY_HOME='' → loud-fail 门禁逻辑存在
# Case 3: detectQuotaWall 函数导出且 6 个 pattern 覆盖
# Case 4: HEADED_HOSTS/HEADED_TMUX_PREFIXES 含 grok 条目
# Case 5: grok containerId 命名规约 -gk 后缀
# Case 6: orchestrator_host='skill-relay-grok' 内联在 SQL
# Case 7: GROK_RELAY_DEADLINE_HOURS=8（对齐 codex 等级）
# Case 8: 永久池 grok 合同单测全部通过
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BRAIN_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
REPO_ROOT="$(cd "$BRAIN_ROOT/../.." && pwd)"
RELAY_SRC="$BRAIN_ROOT/src/harness-skill-relay.js"
TEST_FILE="$REPO_ROOT/tests/regression/relay-a598772e/harness-skill-relay-grok.test.js"

echo "[smoke:grok-relay] Case 1: isGrok 分支识别"
node -e "
const js = require('fs').readFileSync('$RELAY_SRC', 'utf8');
if (!/isGrok\s*=\s*task\.payload\?\.executor\s*===\s*'grok'/.test(js)) throw new Error('Case 1 FAIL: 未找到 isGrok 分支');
console.log('  PASS: isGrok 分支存在');
"

echo "[smoke:grok-relay] Case 2: GROK_RELAY_HOME='' loud-fail 门禁"
node -e "
const js = require('fs').readFileSync('$RELAY_SRC', 'utf8');
if (!/GROK_RELAY_HOME/.test(js)) throw new Error('Case 2 FAIL: 未找到 GROK_RELAY_HOME 检查');
if (!/isGrok && grokRelayHome !== undefined && !grokRelayHome/.test(js)) throw new Error('Case 2 FAIL: grok loud-fail 门禁条件不匹配');
console.log('  PASS: GROK_RELAY_HOME loud-fail 门禁存在');
"

echo "[smoke:grok-relay] Case 3: detectQuotaWall 导出且覆盖 6 个 pattern"
node -e "
const js = require('fs').readFileSync('$RELAY_SRC', 'utf8');
if (!/export function detectQuotaWall/.test(js)) throw new Error('Case 3 FAIL: detectQuotaWall 未导出');
const patterns = ['out of credits', 'rate limit', '429', 'quota exceeded', 'quota reached', 'usage limit'];
for (const p of patterns) {
  if (!js.includes(p)) throw new Error('Case 3 FAIL: detectQuotaWall 缺 pattern: ' + p);
}
console.log('  PASS: detectQuotaWall 导出且覆盖全 6 个 pattern');
"

echo "[smoke:grok-relay] Case 4: HEADED_HOSTS/HEADED_TMUX_PREFIXES 含 grok"
node -e "
const js = require('fs').readFileSync('$RELAY_SRC', 'utf8');
if (!/grok:\s*'skill-relay-grok-headed'/.test(js)) throw new Error('Case 4 FAIL: HEADED_HOSTS 缺 grok 条目');
if (!/grok:\s*'grok-relay-'/.test(js)) throw new Error('Case 4 FAIL: HEADED_TMUX_PREFIXES 缺 grok 条目（前缀应为 grok-relay-）');
console.log('  PASS: HEADED_HOSTS 和 HEADED_TMUX_PREFIXES 均含 grok');
"

echo "[smoke:grok-relay] Case 5: grok containerId 命名规约 -gk 后缀"
node -e "
const js = require('fs').readFileSync('$RELAY_SRC', 'utf8');
if (!/cecelia-relay-\\\${short}-gk/.test(js)) throw new Error('Case 5 FAIL: 未找到 -gk 后缀命名规约');
console.log('  PASS: grok containerId 命名规约 -gk 后缀存在');
"

echo "[smoke:grok-relay] Case 6: orchestrator_host='skill-relay-grok' 内联在 SQL"
node -e "
const js = require('fs').readFileSync('$RELAY_SRC', 'utf8');
if (!/skill-relay-grok/.test(js)) throw new Error('Case 6 FAIL: 未找到 skill-relay-grok');
console.log('  PASS: skill-relay-grok 字面值在源码中存在');
"

echo "[smoke:grok-relay] Case 7: GROK_RELAY_DEADLINE_HOURS=8"
node -e "
const js = require('fs').readFileSync('$RELAY_SRC', 'utf8');
if (!/GROK_RELAY_DEADLINE_HOURS\s*=\s*8/.test(js)) throw new Error('Case 7 FAIL: GROK_RELAY_DEADLINE_HOURS 不等于 8');
console.log('  PASS: GROK_RELAY_DEADLINE_HOURS=8');
"

echo "[smoke:grok-relay] Case 8: 永久池 grok 合同单测全部通过"
[ -f "$TEST_FILE" ] || { echo "  FAIL: 测试文件不存在 $TEST_FILE"; exit 1; }
cd "$REPO_ROOT"
npx vitest run "$TEST_FILE" --reporter=verbose 2>&1 | tail -5
echo "  PASS: 永久池 grok 合同单测全部通过"

echo "[smoke:grok-relay] ✅ 全部通过"
