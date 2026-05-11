# DoD — fix(brain): buildGeneratorPrompt inline SKILL pattern (Bug 7)

## ARTIFACT 条目

- [x] [ARTIFACT] harness-utils.js 含 import loadSkillContent
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/harness-utils.js','utf8');if(!c.includes(\"import { loadSkillContent } from './harness-shared.js'\"))process.exit(1)"`

- [x] [ARTIFACT] buildGeneratorPrompt 调用 loadSkillContent('harness-generator')
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/harness-utils.js','utf8');if(!c.includes(\"loadSkillContent('harness-generator')\"))process.exit(1)"`

- [x] [ARTIFACT] buildGeneratorPrompt 第一行是 inline agent 引导
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/harness-utils.js','utf8');if(!c.includes(\"'你是 harness-generator agent。按下面 SKILL 指令工作。'\"))process.exit(1)"`

- [x] [ARTIFACT] Learning 文件存在
  Test: `manual:node -e "const c=require('fs').readFileSync('docs/learnings/cp-0511125107-brain-generator-inline-skill.md','utf8');if(!c.includes('### 根本原因')||!c.includes('### 下次预防'))process.exit(1)"`

## BEHAVIOR 条目

- [x] [BEHAVIOR] buildGeneratorPrompt 普通模式 inline pattern + 含 task 数据
  Test: tests/harness-utils.test.js (`buildGeneratorPrompt > 普通模式 inline SKILL pattern`)

- [x] [BEHAVIOR] buildGeneratorPrompt fix mode 含 FIX mode 标记
  Test: tests/harness-utils.test.js (`buildGeneratorPrompt > fix mode inline pattern`)

- [x] [BEHAVIOR] 10 个 harness-utils 测试全过
  Test: `manual:bash -c "cd packages/brain && npx vitest run src/workflows/__tests__/harness-utils.test.js"`

## 成功标准（runtime — PR 合并后由 W25 验）

- [ ] PR 创建 + CI 全绿
- [ ] PR merged 到 main
- [ ] 派 W25：generator prompt 文件 > 14KB（inline SKILL 后大小）
- [ ] generator prompt 含 "Contract Self-Verification" 关键词

## 不做

- 不改 SKILL.md
- 不抽 buildAgentPrompt helper（PR F）
