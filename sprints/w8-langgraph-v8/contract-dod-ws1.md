---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: acceptance-fixture（最短 Golden Path 派发载荷）

**范围**：在 `sprints/w8-langgraph-v8/acceptance-fixture.json` 写一个最小合法 harness Initiative 派发体（task_type=harness_initiative + payload.prd_content + 1 个 sub_task），acceptance 脚本和集成测试都用它做输入。
**大小**：S
**依赖**：无

## ARTIFACT 条目

- [ ] [ARTIFACT] `sprints/w8-langgraph-v8/acceptance-fixture.json` 文件存在且 JSON 合法
  Test: `node -e "JSON.parse(require('fs').readFileSync('sprints/w8-langgraph-v8/acceptance-fixture.json','utf8'))"`

- [ ] [ARTIFACT] `acceptance-fixture.json` 顶层 task_type 字段 = "harness_initiative"
  Test: `node -e "const j=JSON.parse(require('fs').readFileSync('sprints/w8-langgraph-v8/acceptance-fixture.json','utf8'));process.exit(j.task_type==='harness_initiative'?0:1)"`

- [ ] [ARTIFACT] `acceptance-fixture.json` payload.prd_content 长度 ≥ 200 字符（防过短被 ganLoop 拒）
  Test: `node -e "const j=JSON.parse(require('fs').readFileSync('sprints/w8-langgraph-v8/acceptance-fixture.json','utf8'));process.exit((j.payload?.prd_content||'').length>=200?0:1)"`

- [ ] [ARTIFACT] `acceptance-fixture.json` payload.task_plan 是数组且 length ≥ 1（至少 1 个 sub_task）
  Test: `node -e "const j=JSON.parse(require('fs').readFileSync('sprints/w8-langgraph-v8/acceptance-fixture.json','utf8'));process.exit(Array.isArray(j.payload?.task_plan)&&j.payload.task_plan.length>=1?0:1)"`

- [ ] [ARTIFACT] `acceptance-fixture.json` payload.fixture_marker = true（acceptance 标记，便于事后 SELECT 区分真任务）
  Test: `node -e "const j=JSON.parse(require('fs').readFileSync('sprints/w8-langgraph-v8/acceptance-fixture.json','utf8'));process.exit(j.payload?.fixture_marker===true?0:1)"`

## BEHAVIOR 索引（实际测试在 tests/ws1/）

见 `tests/ws1/fixture-shape.test.ts`，覆盖：
- fixture JSON 可解析为合法对象
- task_type === 'harness_initiative'
- payload.prd_content 长度 ≥ 200
- payload.task_plan 至少 1 个 sub_task 且每个 sub_task 含 id/title/dod 字段
- payload.fixture_marker === true
