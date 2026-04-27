# Contract DoD — Workstream 1: Pre-flight 校验器核心

**范围**: 实现 `packages/brain/src/preflight.js` 的 `validatePreflight(initiativeDir)` 纯函数（PRD 段校验 / task-plan.json schema 校验 / DAG 拓扑校验）
**大小**: M
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] preflight.js 文件存在
  Test: node -e "require('fs').accessSync('packages/brain/src/preflight.js')"

- [ ] [ARTIFACT] preflight.js 导出 validatePreflight 函数
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/preflight.js','utf8');if(!/export\s+(async\s+)?function\s+validatePreflight\b|export\s*\{[^}]*\bvalidatePreflight\b/.test(c))process.exit(1)"

- [ ] [ARTIFACT] preflight.js 定义 REQUIRED_PRD_SECTIONS 含 5 个必填段
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/preflight.js','utf8');const m=c.match(/REQUIRED_PRD_SECTIONS\s*=\s*\[([^\]]+)\]/);if(!m)process.exit(1);const list=m[1];['目标','User Stories','验收场景','功能需求','成功标准'].forEach(s=>{if(!list.includes(s))process.exit(2)})"

- [ ] [ARTIFACT] preflight.js 定义 MIN_TASKS=1 与 MAX_TASKS=8
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/preflight.js','utf8');if(!/const\s+MIN_TASKS\s*=\s*1\b/.test(c))process.exit(1);if(!/const\s+MAX_TASKS\s*=\s*8\b/.test(c))process.exit(2)"

- [ ] [ARTIFACT] preflight.js 定义 MIN_ESTIMATED_MINUTES=20 与 MAX_ESTIMATED_MINUTES=60
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/preflight.js','utf8');if(!/const\s+MIN_ESTIMATED_MINUTES\s*=\s*20\b/.test(c))process.exit(1);if(!/const\s+MAX_ESTIMATED_MINUTES\s*=\s*60\b/.test(c))process.exit(2)"

## BEHAVIOR 索引（实际测试在 tests/ws1/）

见 `tests/ws1/preflight-validator.test.ts`，覆盖：
- returns pass with empty failures for fully compliant initiative
- returns fail with prd_empty when sprint-prd.md is empty
- returns fail with missing_section code listing the absent section
- returns fail with task_plan_missing when task-plan.json absent
- returns fail with dag_cycle_detected and lists cycle node ids
- returns fail with self_dependency when a task depends on itself
- returns fail with dangling_dependency naming the missing task_id
- returns fail with task_count_out_of_range when tasks > 8 or < 1
- returns fail with estimated_minutes_out_of_range for any task outside [20,60]
- returns fail with empty_dod when any task has zero dod entries
- completes validation in under 200 ms for a typical initiative
