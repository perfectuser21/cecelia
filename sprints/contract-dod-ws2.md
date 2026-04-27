# Contract DoD — Workstream 2: PRD Structure Validator

**范围**: 在 `sprints/validators/prd-structure.mjs` 实现 `validatePrdStructure(content)`，按 9 段标题字面量切片并检查每段非空。
**大小**: M（100-200 行实现）
**依赖**: WS1

> **DoD 机检约定**: 所有 Test 命令均为 shell 单行，非 0 退出 = 红。CI 可 `set -e` 串起来跑。

## ARTIFACT 条目

- [ ] [ARTIFACT] `sprints/sprint-prd.md` 含 `## OKR 对齐` 二级标题
  Test: grep -cE '^##[[:space:]]+OKR 对齐[[:space:]]*$' sprints/sprint-prd.md

- [ ] [ARTIFACT] `sprints/sprint-prd.md` 含 `## 背景` 二级标题
  Test: grep -cE '^##[[:space:]]+背景[[:space:]]*$' sprints/sprint-prd.md

- [ ] [ARTIFACT] `sprints/sprint-prd.md` 含 `## 目标` 二级标题
  Test: grep -cE '^##[[:space:]]+目标[[:space:]]*$' sprints/sprint-prd.md

- [ ] [ARTIFACT] `sprints/sprint-prd.md` 含 `## User Stories` 二级标题
  Test: grep -cE '^##[[:space:]]+User Stories[[:space:]]*$' sprints/sprint-prd.md

- [ ] [ARTIFACT] `sprints/sprint-prd.md` 含 `## 验收场景` 二级标题（允许标题尾部有括注）
  Test: grep -cE '^##[[:space:]]+验收场景' sprints/sprint-prd.md

- [ ] [ARTIFACT] `sprints/sprint-prd.md` 含 `## 功能需求` 二级标题
  Test: grep -cE '^##[[:space:]]+功能需求[[:space:]]*$' sprints/sprint-prd.md

- [ ] [ARTIFACT] `sprints/sprint-prd.md` 含 `## 成功标准` 二级标题
  Test: grep -cE '^##[[:space:]]+成功标准[[:space:]]*$' sprints/sprint-prd.md

- [ ] [ARTIFACT] `sprints/sprint-prd.md` 含 `## 假设` 二级标题
  Test: grep -cE '^##[[:space:]]+假设[[:space:]]*$' sprints/sprint-prd.md

- [ ] [ARTIFACT] `sprints/sprint-prd.md` 含 `## 边界情况` 二级标题
  Test: grep -cE '^##[[:space:]]+边界情况[[:space:]]*$' sprints/sprint-prd.md

- [ ] [ARTIFACT] `sprints/validators/prd-structure.mjs` 文件存在
  Test: test -f sprints/validators/prd-structure.mjs

- [ ] [ARTIFACT] `sprints/validators/prd-structure.mjs` 运行时 export 名为 `validatePrdStructure` 的 function
  Test: node -e "import('./sprints/validators/prd-structure.mjs').then(m=>process.exit(typeof m.validatePrdStructure==='function'?0:1)).catch(()=>process.exit(2))"

## BEHAVIOR 索引（实际测试在 tests/ws2/）

见 `tests/ws2/prd-structure.test.ts`，覆盖：
- returns ok=true with sections=9 for the real Initiative B2 PRD
- returns ok=false listing all 9 missing section names when given an empty document
- returns ok=false with emptySections naming the offending heading when a section body is whitespace-only
- treats sections separated only by code fences as empty
