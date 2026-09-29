#!/usr/bin/env bash
# packages/brain/scripts/smoke/qiumi-model-family-smoke.sh
# Smoke: 秋米【执行参数】模型写系列名自动取最新（决策 49d17c60，任务 c271d6a8）。
#   用 09-29 MMV 实测收敛后的生产允许清单（21 个）验证：每个系列名落到该系列最新可用型号，
#   显示名写法可识别，实测失败的型号（opus-5-5 等）不在清单里、写了会被判 unknown_model。
set -euo pipefail
cd "$(dirname "$0")/../.."

node --input-type=module -e "
import { parseExecParams } from './src/routing/exec-params.js';
const allow = ['openai/gpt-6-sol','openai/gpt-5.6-sol','openai/gpt-6-astra','openai/gpt-5.6-terra','openai/gpt-5.6-luna','openai/gpt-5.5',
  'anthropic/claude-opus-5','anthropic/claude-opus-4-8','anthropic/claude-opus-4-7','anthropic/claude-opus-4-6',
  'anthropic/claude-sonnet-5','anthropic/claude-sonnet-4-6','anthropic/claude-fable-5-1','anthropic/claude-fable-5',
  'anthropic/claude-haiku-4-5','anthropic/claude-haiku-4-5-20251001',
  'xai/grok-4.7','xai/grok-4.6','xai/grok-4.3','xai/grok-4.20-reasoning','xai/grok-build-0.1'];
const pick = (v) => parseExecParams('【执行参数】\n模型：' + v + '\n【执行参数结束】', { modelAllowlist: allow });
const expect = {
  Sol: 'openai/gpt-6-sol', Terra: 'openai/gpt-5.6-terra', Luna: 'openai/gpt-5.6-luna', Astra: 'openai/gpt-6-astra',
  Opus: 'anthropic/claude-opus-5', Sonnet: 'anthropic/claude-sonnet-5', Fable: 'anthropic/claude-fable-5-1',
  Haiku: 'anthropic/claude-haiku-4-5', Grok: 'xai/grok-4.7',
  'GPT-6 Sol': 'openai/gpt-6-sol', 'Opus 4.8': 'anthropic/claude-opus-4-8', claude: 'anthropic/claude-sonnet-5', codex: 'openai/gpt-5.6-terra',
};
let bad = 0;
for (const [k, v] of Object.entries(expect)) {
  const got = pick(k).model;
  if (got !== v) { console.error('FAIL', k, '→', got, '期望', v); bad += 1; } else console.log('PASS', k, '→', got);
}
const broken = pick('claude-opus-5-5');
if (broken.model !== null || !broken.errors.includes('unknown_model')) { console.error('FAIL 实测失败的 opus-5-5 不该被接受'); bad += 1; }
else console.log('PASS 实测失败的 opus-5-5 被拒（unknown_model）');
process.exit(bad ? 1 : 0);
"
echo "✅ 模型系列名解析全部通过"
