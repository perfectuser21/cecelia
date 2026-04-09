# DoD: Harness GAN v2

## F1: model-profile.js 模型分配

- [x] [ARTIFACT] model-profile.js FALLBACK_PROFILE 包含 harness GAN→Opus, Generator→Sonnet 配置
  Test: node -e "import('./packages/brain/src/model-profile.js').then(m=>{const mp=m.FALLBACK_PROFILE.config.executor.model_map;if(mp.harness_contract_propose?.anthropic!=='claude-opus-4-6')process.exit(1);if(mp.harness_generate?.anthropic!=='claude-sonnet-4-6')process.exit(1);console.log('OK')})"

## F2: Proposer skill — Workstreams 格式

- [x] [ARTIFACT] harness-contract-proposer/SKILL.md 包含 Workstreams 区块格式 + workstream_count 输出
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-contract-proposer/SKILL.md','utf8');if(!c.includes('Workstreams'))process.exit(1);if(!c.includes('workstream_count'))process.exit(1);console.log('OK')"

## F3: Reviewer skill — Workstream 审查

- [x] [ARTIFACT] harness-contract-reviewer/SKILL.md 包含 Workstream 审查条件 + workstream_count 输出
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-contract-reviewer/SKILL.md','utf8');if(!c.includes('Workstream'))process.exit(1);if(!c.includes('workstream_count'))process.exit(1);console.log('OK')"

## F4: execution.js — 多 workstream 拆分

- [x] [BEHAVIOR] execution.js APPROVED 后读 workstream_count 并创建 N 个 harness_generate
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');if(!c.includes('workstream_index'))process.exit(1);if(!c.includes('workstream_count'))process.exit(1);if(!c.includes('safeWsCount'))process.exit(1);console.log('OK')"

## F5: Generator skill — Workstream 定向实现

- [x] [ARTIFACT] harness-generator/SKILL.md 包含 workstream_index 读取和合同 DoD 复制指令
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-generator/SKILL.md','utf8');if(!c.includes('workstream_index'))process.exit(1);if(!c.includes('DoD 条目'))process.exit(1);console.log('OK')"

## F6: executor.js — workstream 参数注入 prompt

- [x] [BEHAVIOR] executor.js 在构建 harness_generate prompt 时注入 workstream_index 和 workstream_count
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/executor.js','utf8');if(!c.includes('workstream_index'))process.exit(1);if(!c.includes('workstream_count'))process.exit(1);console.log('OK')"
