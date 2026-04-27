# Contract DoD — Workstream 2: PRD Structure Validator

**范围**: 在 `sprints/validators/prd-structure.mjs` 实现 `validatePrdStructure(content)`，按 9 段标题字面量切片并检查每段非空。
**大小**: M（100-200 行实现）
**依赖**: WS1

## ARTIFACT 条目

- [ ] [ARTIFACT] `sprints/sprint-prd.md` 含 `## OKR 对齐` 二级标题
  Test: node -e "const c=require('fs').readFileSync('sprints/sprint-prd.md','utf8');if(!/^##\s+OKR 对齐\s*$/m.test(c))throw new Error('FAIL:missing OKR 对齐');console.log('PASS')"

- [ ] [ARTIFACT] `sprints/sprint-prd.md` 含 `## 背景` 二级标题
  Test: node -e "const c=require('fs').readFileSync('sprints/sprint-prd.md','utf8');if(!/^##\s+背景\s*$/m.test(c))throw new Error('FAIL:missing 背景');console.log('PASS')"

- [ ] [ARTIFACT] `sprints/sprint-prd.md` 含 `## 目标` 二级标题
  Test: node -e "const c=require('fs').readFileSync('sprints/sprint-prd.md','utf8');if(!/^##\s+目标\s*$/m.test(c))throw new Error('FAIL:missing 目标');console.log('PASS')"

- [ ] [ARTIFACT] `sprints/sprint-prd.md` 含 `## User Stories` 二级标题
  Test: node -e "const c=require('fs').readFileSync('sprints/sprint-prd.md','utf8');if(!/^##\s+User Stories\s*$/m.test(c))throw new Error('FAIL:missing User Stories');console.log('PASS')"

- [ ] [ARTIFACT] `sprints/sprint-prd.md` 含 `## 验收场景` 二级标题（允许标题尾部有括注）
  Test: node -e "const c=require('fs').readFileSync('sprints/sprint-prd.md','utf8');if(!/^##\s+验收场景/m.test(c))throw new Error('FAIL:missing 验收场景');console.log('PASS')"

- [ ] [ARTIFACT] `sprints/sprint-prd.md` 含 `## 功能需求` 二级标题
  Test: node -e "const c=require('fs').readFileSync('sprints/sprint-prd.md','utf8');if(!/^##\s+功能需求\s*$/m.test(c))throw new Error('FAIL:missing 功能需求');console.log('PASS')"

- [ ] [ARTIFACT] `sprints/sprint-prd.md` 含 `## 成功标准` 二级标题
  Test: node -e "const c=require('fs').readFileSync('sprints/sprint-prd.md','utf8');if(!/^##\s+成功标准\s*$/m.test(c))throw new Error('FAIL:missing 成功标准');console.log('PASS')"

- [ ] [ARTIFACT] `sprints/sprint-prd.md` 含 `## 假设` 二级标题
  Test: node -e "const c=require('fs').readFileSync('sprints/sprint-prd.md','utf8');if(!/^##\s+假设\s*$/m.test(c))throw new Error('FAIL:missing 假设');console.log('PASS')"

- [ ] [ARTIFACT] `sprints/sprint-prd.md` 含 `## 边界情况` 二级标题
  Test: node -e "const c=require('fs').readFileSync('sprints/sprint-prd.md','utf8');if(!/^##\s+边界情况\s*$/m.test(c))throw new Error('FAIL:missing 边界情况');console.log('PASS')"

- [ ] [ARTIFACT] `sprints/validators/prd-structure.mjs` 文件存在
  Test: node -e "require('fs').accessSync('sprints/validators/prd-structure.mjs');console.log('PASS:exists')"

- [ ] [ARTIFACT] `sprints/validators/prd-structure.mjs` export 名为 `validatePrdStructure` 的 function
  Test: node -e "const c=require('fs').readFileSync('sprints/validators/prd-structure.mjs','utf8');if(!/export\s+(async\s+)?function\s+validatePrdStructure\b/.test(c)&&!/export\s*\{\s*[^}]*\bvalidatePrdStructure\b[^}]*\}/.test(c))throw new Error('FAIL:no export validatePrdStructure');console.log('PASS:export found')"

## BEHAVIOR 索引（实际测试在 tests/ws2/）

见 `tests/ws2/prd-structure.test.ts`，覆盖：
- returns ok=true with sections=9 for the real Initiative B2 PRD
- returns ok=false listing all 9 missing section names when given an empty document
- returns ok=false with emptySections naming the offending heading when a section body is whitespace-only
- treats sections separated only by code fences as empty
