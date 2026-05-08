---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: 部署校验 + acceptance v4 派发 + 14 节点事件流验证 helper

**范围**: 实现 `scripts/acceptance/w8-v4/lib.mjs` 三函数：`assertBrainImageInSync` / `registerAndDispatchAcceptance` / `waitFor14GraphNodeEvents`
**大小**: M
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] `scripts/acceptance/w8-v4/lib.mjs` 文件存在
  Test: node -e "const fs=require('fs');if(!fs.existsSync('scripts/acceptance/w8-v4/lib.mjs'))process.exit(1)"

- [ ] [ARTIFACT] lib.mjs 导出三个具名函数：assertBrainImageInSync / registerAndDispatchAcceptance / waitFor14GraphNodeEvents
  Test: node -e "import('./scripts/acceptance/w8-v4/lib.mjs').then(m => { if (typeof m.assertBrainImageInSync !== 'function' || typeof m.registerAndDispatchAcceptance !== 'function' || typeof m.waitFor14GraphNodeEvents !== 'function') process.exit(1); })"

- [ ] [ARTIFACT] lib.mjs 内含 14 节点期望列表常量（防止下游 hardcode 漂移）
  Test: node -e "const c=require('fs').readFileSync('scripts/acceptance/w8-v4/lib.mjs','utf8'); const expected=['prep','planner','parsePrd','ganLoop','inferTaskPlan','dbUpsert','pick_sub_task','run_sub_task','evaluate','advance','retry','terminal_fail','final_evaluate','report']; for(const n of expected){ if(!c.includes('\"'+n+'\"') && !c.includes(\"'\"+n+\"'\")) process.exit(1); }"

- [ ] [ARTIFACT] lib.mjs 内含严格 propose_branch 正则：cp-harness-propose-r[1-9]\d*-[a-f0-9]{8}
  Test: node -e "const c=require('fs').readFileSync('scripts/acceptance/w8-v4/lib.mjs','utf8'); if(!c.match(/cp-harness-propose-r\[1-9\]\\\\d\*-\[a-f0-9\]\{8\}/)) process.exit(1);"

## BEHAVIOR 索引（实际测试在 tests/ws1/）

见 `tests/ws1/acceptance-helper.test.ts`，覆盖：
- `assertBrainImageInSync` 在 brain HEAD ≠ origin/main 时抛错（错误信息含 "stale" / "mismatch" / 真实 commit hash）
- `registerAndDispatchAcceptance` 注册 + dispatch 双调用成功路径返回 task_id；任一 HTTP fail 时抛错
- `waitFor14GraphNodeEvents` 在 14 节点齐全时返回 distinct 列表；缺节点时抛错并指出哪个缺
- `waitFor14GraphNodeEvents` inferTaskPlan branch 不匹配 PR #2837 修后正则时抛错
