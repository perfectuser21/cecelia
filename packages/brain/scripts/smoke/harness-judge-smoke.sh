#!/usr/bin/env bash
# harness-judge-smoke.sh — 独立验收裁判（DeepSeek via ToAPIs）post-deploy smoke。
#
# 验证：
#   1. 裁判门逻辑（注入 mock judgeFn 走三权分立关键路径）—— 无外部依赖，恒跑
#   2. ToAPIs 凭据可解析（env 或 ~/.credentials/toapis.env）—— 无 key 时 SKIP 第 3 步
#   3. 真实 DeepSeek 裁判调用返回合法 JSON verdict —— 有 key 时跑
#
# 使用：bash packages/brain/scripts/smoke/harness-judge-smoke.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$REPO_ROOT"

echo "[smoke] harness-judge: 1) 裁判门逻辑（mock judge）"
node sprints/06121644-judge-deepseek/behaviors/b1-judge-gate.mjs >/dev/null
echo "[smoke] harness-judge: 裁判门逻辑 OK"

# 解析 ToAPIs 配置（env 优先 → ~/.credentials/toapis.env 兜底）
HAS_KEY=$(node --input-type=module -e "
import { resolveToapisConfig } from './packages/brain/src/harness-judge.js';
const cfg = await resolveToapisConfig();
process.stdout.write(cfg.apiKey ? '1' : '0');
" 2>/dev/null || echo "0")

if [ "$HAS_KEY" != "1" ]; then
  echo "[smoke] harness-judge: SKIP 真实裁判调用 — 无 TOAPIS_API_KEY（CI/无凭据环境）"
  echo "[smoke] harness-judge: PASS"
  exit 0
fi

echo "[smoke] harness-judge: 2) 真实 DeepSeek 裁判调用"
node --input-type=module -e "
import { callDeepSeekJudge } from './packages/brain/src/harness-judge.js';
const r = await callDeepSeekJudge({
  contractE2E: 'curl 端点返回 200 + JSON',
  goldenPathSteps: ['curl 返回 200', '看到结果'],
  agentVerdict: 'PASS',
  transcript: 'STEP1: http_code=200\nSTEP2: result ok\nPASS',
  brainResult: { verdict: 'PASS' },
}, { timeoutMs: 60000 });
if (r.verdict !== 'PASS' && r.verdict !== 'FAIL') { console.error('非法 verdict: ' + r.verdict); process.exit(1); }
if (!Array.isArray(r.coverage)) { console.error('coverage 非数组'); process.exit(1); }
console.log('[smoke] 真实裁判 verdict=' + r.verdict + ' coverage=' + r.coverage.length + ' 项');
"
echo "[smoke] harness-judge: PASS"
