---
skeleton: false
journey_type: dev_pipeline
---
# Contract DoD — Workstream 1: docs/learnings/w8-langgraph-v16-e2e.md

**范围**：Walking Skeleton noop 模式下 generator 节点产出的唯一文件 — `docs/learnings/w8-langgraph-v16-e2e.md`。
**大小**：S（< 100 行 markdown）
**依赖**：无

## ARTIFACT 条目

- [ ] [ARTIFACT] 文件 `docs/learnings/w8-langgraph-v16-e2e.md` 存在且非空
  Test: node -e "const s=require('fs').statSync('docs/learnings/w8-langgraph-v16-e2e.md');if(s.size<500)process.exit(1)"

- [ ] [ARTIFACT] 文件含 5 个 LangGraph 节点 duration（planner/proposer/reviewer/generator/evaluator 各一个数字 + 时间单位）
  Test: node -e "const c=require('fs').readFileSync('docs/learnings/w8-langgraph-v16-e2e.md','utf8');for(const n of ['planner','proposer','reviewer','generator','evaluator']){if(!new RegExp(n+'[^|\\\\n]*[0-9]+\\\\s*(s|sec|分|min)','i').test(c)){console.error('miss',n);process.exit(1)}}"

- [ ] [ARTIFACT] 文件含 GAN proposer/reviewer 轮数
  Test: node -e "const c=require('fs').readFileSync('docs/learnings/w8-langgraph-v16-e2e.md','utf8');if(!/gan[^|\\n]*(rounds?|轮)[^|\\n]*[0-9]+/i.test(c))process.exit(1)"

- [ ] [ARTIFACT] 文件含合法 GitHub PR URL
  Test: node -e "const c=require('fs').readFileSync('docs/learnings/w8-langgraph-v16-e2e.md','utf8');if(!/https:\\/\\/github\\.com\\/[^\\/\\s]+\\/[^\\/\\s]+\\/pull\\/[0-9]+/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 不修改 packages/brain、packages/engine、packages/workflows 任何运行时代码（PRD 范围限定）
  Test: bash -c "git diff --name-only origin/main...HEAD | grep -E '^packages/(brain|engine|workflows)/' | grep -vE '\\.(md|json)$' && exit 1 || exit 0"

## BEHAVIOR 索引（实际测试在 tests/ws1/）

见 `tests/ws1/v16-e2e-completion.test.ts`，三个 `it` 块严格对应 (a)(b)(c)：
- (a) generator sub_task `status === 'completed'` 由 evaluator callback 写入
- (b) generator sub_task `result.pr_url` 匹配 GitHub PR URL 正则
- (c) generator.updated_at 与 evaluator.callback_at 漂移 ≤ 300s（强制证明非人工 PATCH —— PRD 第 7 条硬保证）
