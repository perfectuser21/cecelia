---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: 派发脚本（scripts/v15-dispatch.mjs）

**范围**：Node.js 脚本，连 `DATABASE_URL` 用 `pg` 直接 INSERT 一行 `task_type='harness_initiative'`，
`status='queued'`，payload 含一个最小测试 PRD（≤30min 跑完）。stdout 单行 UUID。

**大小**：S

**依赖**：无

## ARTIFACT 条目

- [ ] [ARTIFACT] `scripts/v15-dispatch.mjs` 文件存在
  Test: node -e "require('fs').accessSync('scripts/v15-dispatch.mjs')"

- [ ] [ARTIFACT] 脚本以 ESM 写就且 import 'pg'
  Test: node -e "const c=require('fs').readFileSync('scripts/v15-dispatch.mjs','utf8');if(!/from ['\"]pg['\"]/.test(c) && !/require\\(['\"]pg['\"]\\)/.test(c)) process.exit(1)"

- [ ] [ARTIFACT] 脚本含 `task_type: 'harness_initiative'`（防止误改成 retired 类型）
  Test: node -e "const c=require('fs').readFileSync('scripts/v15-dispatch.mjs','utf8');if(!c.includes(\"'harness_initiative'\") && !c.includes('\"harness_initiative\"')) process.exit(1)"

- [ ] [ARTIFACT] 脚本读取 `process.env.DATABASE_URL`
  Test: node -e "const c=require('fs').readFileSync('scripts/v15-dispatch.mjs','utf8');if(!c.includes('DATABASE_URL')) process.exit(1)"

- [ ] [ARTIFACT] 脚本导出可测试的纯函数（buildTestPrd / buildPayload 之一），便于 vitest 引用
  Test: node -e "const c=require('fs').readFileSync('scripts/v15-dispatch.mjs','utf8');if(!/export\\s+(function|const)\\s+(buildTestPrd|buildPayload)/.test(c)) process.exit(1)"

## BEHAVIOR 索引（实际测试在 tests/ws1/）

见 `tests/ws1/dispatch.test.ts`，覆盖：
- buildPayload() 返回对象含 initiative_id（UUID）、prd（非空字符串）、journey_type='autonomous'
- buildTestPrd() 返回的 PRD 文本含 Golden Path 段头（验证是真 PRD 不是占位）
- 缺 DATABASE_URL 时主流程抛错（用 mock 验证）
- INSERT SQL 字符串含 `RETURNING id`
