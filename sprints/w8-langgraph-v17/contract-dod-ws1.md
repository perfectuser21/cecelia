---
skeleton: true
journey_type: autonomous
---
# Contract DoD — Workstream 1: walking skeleton learnings doc

**范围**: 在 `docs/learnings/w8-langgraph-v17-e2e.md` 写一份 walking skeleton 实证文档（含 run_date / node_durations / gan_proposer_rounds / pr_url / 任务定位 / DoD 列表占位 + R1-R4 边界 mitigation 段落占位）。不修改任何运行时代码（packages/brain | packages/engine | packages/workflows 零变更）。

**大小**: S（单个 markdown 文件 < 100 行）

**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] `docs/learnings/w8-langgraph-v17-e2e.md` 文件存在
  Test: node -e "require('fs').statSync('docs/learnings/w8-langgraph-v17-e2e.md')"

- [ ] [ARTIFACT] 首行包含字符串 `W8 v17 LangGraph`
  Test: node -e "const c=require('fs').readFileSync('docs/learnings/w8-langgraph-v17-e2e.md','utf8');if(!c.split('\n')[0].includes('W8 v17 LangGraph'))process.exit(1)"

- [ ] [ARTIFACT] 文件含字段 `run_date:`
  Test: node -e "const c=require('fs').readFileSync('docs/learnings/w8-langgraph-v17-e2e.md','utf8');if(!/run_date:/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 文件含 `node_durations:` 段并枚举 PLANNER/PROPOSER/REVIEWER/GENERATOR/EVALUATOR
  Test: node -e "const c=require('fs').readFileSync('docs/learnings/w8-langgraph-v17-e2e.md','utf8');for(const k of ['node_durations:','PLANNER','PROPOSER','REVIEWER','GENERATOR','EVALUATOR']){if(!c.includes(k))process.exit(1)}"

- [ ] [ARTIFACT] 文件含字段 `gan_proposer_rounds:`
  Test: node -e "const c=require('fs').readFileSync('docs/learnings/w8-langgraph-v17-e2e.md','utf8');if(!/gan_proposer_rounds:/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 文件含字段 `pr_url:`
  Test: node -e "const c=require('fs').readFileSync('docs/learnings/w8-langgraph-v17-e2e.md','utf8');if(!/pr_url:/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 文件自指 sprint dir（含 `sprints/w8-langgraph-v17`）
  Test: node -e "const c=require('fs').readFileSync('docs/learnings/w8-langgraph-v17-e2e.md','utf8');if(!c.includes('sprints/w8-langgraph-v17'))process.exit(1)"

- [ ] [ARTIFACT] 文件包含至少一个 DoD 列表条目（带 `- ` 前缀且引用 evaluator/PR/tasks 之一）
  Test: node -e "const c=require('fs').readFileSync('docs/learnings/w8-langgraph-v17-e2e.md','utf8');if(!/^-\s.+(evaluator|PR|tasks)/im.test(c))process.exit(1)"

- [ ] [ARTIFACT] 文件含 R1-R4 边界 mitigation 段落（W1 thread_id 版本化 / callback-queue-persistence / retryPolicy / H11 独立 worktree 四个关键词全到位）
  Test: node -e "const c=require('fs').readFileSync('docs/learnings/w8-langgraph-v17-e2e.md','utf8');for(const k of ['thread_id','callback','retryPolicy','H11']){if(!c.includes(k))process.exit(1)}"

- [ ] [ARTIFACT] 不修改运行时代码 — PR 范围仅含 `sprints/w8-langgraph-v17/` 和 `docs/learnings/w8-langgraph-v17-e2e.md`
  Test: bash -c "git diff --name-only origin/main...HEAD | grep -vE '^(sprints/w8-langgraph-v17/|docs/learnings/w8-langgraph-v17-e2e\.md)$' && exit 1 || exit 0"

## BEHAVIOR 索引（实际测试在 tests/ws1/）

见 `tests/ws1/learnings-doc.test.ts`，覆盖：
- 文件存在且首行标题正确
- 必填占位字段全到位（run_date / node_durations 五节点 / gan_proposer_rounds / pr_url）
- 文件自指本 sprint dir
- DoD 列表至少一条引用 evaluator/PR/tasks 之一
- 文件长度合理（5 ~ 200 行）
- R1-R4 边界 mitigation 关键词段落（thread_id / callback / retryPolicy / H11）全到位
