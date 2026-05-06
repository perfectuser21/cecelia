# Contract DoD — Workstream 2: F3 回血回填（callback → KR +1%）

**范围**: 在 `progress-reviewer.js` 新增 thin 计数函数 `incrementKRProgressByOnePercent(krId)`；`callback-processor.js` 在 task=completed + pr_url + kr_id 三齐全时调用一次。
**大小**: S
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/src/progress-reviewer.js` 命名导出 `incrementKRProgressByOnePercent`
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/progress-reviewer.js','utf8');if(!/export\s+(async\s+)?function\s+incrementKRProgressByOnePercent\b/.test(c)&&!/export\s*\{[^}]*\bincrementKRProgressByOnePercent\b/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/src/callback-processor.js` 引用 `incrementKRProgressByOnePercent`
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/callback-processor.js','utf8');if(!c.includes('incrementKRProgressByOnePercent'))process.exit(1)"

- [ ] [ARTIFACT] callback-processor.js 出现 100 封顶常量或表达式（防溢出标记）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/progress-reviewer.js','utf8');if(!/Math\.min\([^)]*100\)|LEAST\([^)]*100\)|\bcap\s*=\s*100\b|<\s*100\b/.test(c))process.exit(1)"

## BEHAVIOR 索引（实际测试在 tests/ws2/）

见 `tests/ws2/callback-kr-update.test.ts`，覆盖：
- progress-reviewer.js 导出 incrementKRProgressByOnePercent
- completed task with kr_id (kr at 50) → KR progress 升至 51
- completed task with kr_id (kr at 100) → KR progress 仍为 100，不溢出
- completed task with kr_id (kr at 99) → KR progress 升至 100
- completed task without kr_id → 不调用 incrementKRProgressByOnePercent
- completed task without pr_url → 不调用 incrementKRProgressByOnePercent
- callback-processor 在 task=completed + pr_url + kr_id 三齐全时调用 incrementKRProgressByOnePercent 一次
