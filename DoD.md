## Workstream 1: 修复 harness_report 模型配置（Haiku→Sonnet）

- [x] [BEHAVIOR] model-profile.js FALLBACK_PROFILE 中 harness_report.anthropic 为 claude-sonnet-4-6（不再是 Haiku）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/model-profile.js','utf8');const m=c.match(/harness_report[^}]*anthropic[^']*'([^']+)'/);if(!m||m[1]!=='claude-sonnet-4-6')throw new Error('FAIL: got '+(m?m[1]:'not found'));console.log('PASS:',m[1])"
- [x] [BEHAVIOR] model-profile.js 中不再出现 harness_report 使用 claude-haiku 的配置
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/model-profile.js','utf8');const haiku=c.match(/harness_report[^}]*anthropic[^']*'claude-haiku[^']*'/);if(haiku)throw new Error('FAIL: still has haiku: '+haiku[0]);console.log('PASS: no haiku in harness_report')"
