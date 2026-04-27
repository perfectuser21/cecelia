# Contract DoD — Workstream 2: 预检规则模块（纯函数）

**范围**: 仅新增 `packages/brain/src/preflight-rules.js`，导出 `runPreflight({ description, prd, taskPlan })`。不读 DB、不调用 HTTP。
**大小**: M
**依赖**: ws1 完成

## ARTIFACT 条目

- [ ] [ARTIFACT] 文件 `packages/brain/src/preflight-rules.js` 存在
  Test: node -e "require('fs').accessSync('packages/brain/src/preflight-rules.js')"

- [ ] [ARTIFACT] 模块导出名 `runPreflight`
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/preflight-rules.js','utf8');if(!/export\s+(async\s+)?function\s+runPreflight|export\s*\{[^}]*\brunPreflight\b/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 模块为 ESM（含 `export` 关键字）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/preflight-rules.js','utf8');if(!/^export\s/m.test(c))process.exit(1)"

## BEHAVIOR 索引（实际测试在 tests/ws2/）

见 `tests/ws2/preflight-rules.test.ts`，覆盖：
- returns passed with empty reasons for a fully compliant initiative
- returns rejected with dag_has_cycle reason when task-plan contains a 2-task cycle
- returns rejected with prd_missing_section: success_criteria when PRD lacks the section
- returns rejected with task_count_exceeded when task-plan has more than 8 tasks
- returns rejected with description_too_short when description is below 50 characters
- returns rejected with task_missing_field reason when a task lacks estimated_minutes
