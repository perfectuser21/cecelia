# DoD — Harness v5 Sprint B: Generator × Superpowers 融合

## ARTIFACT 条目

- [x] [ARTIFACT] Generator SKILL.md 版本为 5.0.0
  Test: manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-generator/SKILL.md','utf8');if(!/version:\s*5\.0\.0/.test(c))process.exit(1)"

- [x] [ARTIFACT] Generator SKILL.md 引用 4 个 superpowers
  Test: manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-generator/SKILL.md','utf8');const sp=['superpowers:test-driven-development','superpowers:verification-before-completion','superpowers:systematic-debugging','superpowers:requesting-code-review'];for(const s of sp){if(!c.includes(s)){console.error('缺:',s);process.exit(1)}}"

- [x] [ARTIFACT] Generator SKILL.md 含 TDD Red/Green 两次 commit 指引
  Test: manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-generator/SKILL.md','utf8');if(!/\(Red\)/.test(c))process.exit(1);if(!/\(Green\)/.test(c))process.exit(2);if(!/commit 1.*测试|测试.*commit 1/s.test(c))process.exit(3);if(!/commit 2.*实现|实现.*commit 2/s.test(c))process.exit(4)"

- [x] [ARTIFACT] Generator SKILL.md 明确测试文件 commit 1 后不可修改
  Test: manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-generator/SKILL.md','utf8');if(!/不可改|不可修改|禁止.*修改.*测试/.test(c))process.exit(1)"

- [x] [ARTIFACT] Generator SKILL.md 保留 CONTRACT IS LAW + 禁止事项
  Test: manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-generator/SKILL.md','utf8');if(!c.includes('CONTRACT IS LAW'))process.exit(1);if(!/禁止.*合同外/.test(c))process.exit(2);if(!/禁止.*main 分支/.test(c))process.exit(3);if(!/find\s*\/Users/.test(c))process.exit(4)"

- [x] [ARTIFACT] Generator 结构测试文件存在
  Test: manual:node -e "require('fs').accessSync('packages/engine/tests/skills/harness-generator.test.ts')"

- [x] [ARTIFACT] Learning 文件含根本原因 + 下次预防
  Test: manual:node -e "const fs=require('fs');const files=fs.readdirSync('docs/learnings').filter(f=>f.includes('harness-v5-sprint-b'));if(files.length===0)process.exit(1);const c=fs.readFileSync('docs/learnings/'+files[0],'utf8');if(!c.includes('### 根本原因'))process.exit(2);if(!c.includes('### 下次预防'))process.exit(3)"

## BEHAVIOR 条目

- [x] [BEHAVIOR] Generator SKILL.md 完整实现 v5.0 设计（4 superpowers + Red-Green 两 commit + 测试不可改 + Mode 2 systematic-debugging）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-generator/SKILL.md','utf8');const checks=[c.includes('superpowers:test-driven-development'),c.includes('superpowers:verification-before-completion'),c.includes('superpowers:systematic-debugging'),c.includes('superpowers:requesting-code-review'),/\(Red\)/.test(c),/\(Green\)/.test(c),/不可改|不可修改|禁止.*修改.*测试/.test(c),c.includes('CONTRACT IS LAW'),/Mode 2/.test(c)];if(checks.some(v=>!v))process.exit(1);console.log('PASS')"

## 结构测试（vitest 验证 SKILL.md 所有章节）

见 `packages/engine/tests/skills/harness-generator.test.ts`（10 个 it 断言）。

运行：

```bash
cd packages/engine && npx vitest run tests/skills/harness-generator.test.ts --no-coverage
```

预期：`Tests  10 passed (10)`
