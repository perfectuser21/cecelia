# DoD — Harness v5 Sprint A: Proposer / Reviewer 升级

## ARTIFACT 条目

- [x] [ARTIFACT] Proposer SKILL.md 版本为 5.0.0
  Test: manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-contract-proposer/SKILL.md','utf8');if(!/version:\s*5\.0\.0/.test(c))process.exit(1)"

- [x] [ARTIFACT] Reviewer SKILL.md 版本为 5.0.0
  Test: manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-contract-reviewer/SKILL.md','utf8');if(!/version:\s*5\.0\.0/.test(c))process.exit(1)"

- [x] [ARTIFACT] Proposer SKILL.md 含 3 份产物描述 + Test Contract 索引表
  Test: manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-contract-proposer/SKILL.md','utf8');if(!c.includes('tests/ws'))process.exit(1);if(!/\.test\.ts/.test(c))process.exit(2);if(!c.includes('## Test Contract'))process.exit(3)"

- [x] [ARTIFACT] Reviewer SKILL.md 含 Reviewer 心态章节（无上限 + picky）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-contract-reviewer/SKILL.md','utf8');if(!c.includes('Reviewer 心态'))process.exit(1);if(!c.includes('无上限'))process.exit(2);if(!c.includes('picky'))process.exit(3)"

- [x] [ARTIFACT] Reviewer SKILL.md Step 2b 含 fake_impl + proof-of-falsification
  Test: manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-contract-reviewer/SKILL.md','utf8');if(!c.includes('fake_impl'))process.exit(1);if(!c.includes('proof-of-falsification'))process.exit(2);if(!c.includes('test_block'))process.exit(3)"

- [x] [ARTIFACT] Proposer 结构测试文件存在
  Test: manual:node -e "require('fs').accessSync('packages/engine/tests/skills/harness-contract-proposer.test.ts')"

- [x] [ARTIFACT] Reviewer 结构测试文件存在
  Test: manual:node -e "require('fs').accessSync('packages/engine/tests/skills/harness-contract-reviewer.test.ts')"

- [x] [ARTIFACT] Learning 文件含根本原因 + 下次预防
  Test: manual:node -e "const fs=require('fs');const files=fs.readdirSync('docs/learnings').filter(f=>f.includes('harness-v5-sprint-a'));if(files.length===0)process.exit(1);const c=fs.readFileSync('docs/learnings/'+files[0],'utf8');if(!c.includes('### 根本原因'))process.exit(2);if(!c.includes('### 下次预防'))process.exit(3)"

## BEHAVIOR 索引

见 `packages/engine/tests/skills/harness-contract-proposer.test.ts`（7 个 it）+ `packages/engine/tests/skills/harness-contract-reviewer.test.ts`（8 个 it），共 15 个结构性 behavior 断言。

运行：

```bash
cd packages/engine && npx vitest run tests/skills/harness-contract-proposer.test.ts tests/skills/harness-contract-reviewer.test.ts --no-coverage
```

预期：`Tests  15 passed (15)`
