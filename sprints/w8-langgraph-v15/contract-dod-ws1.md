---
skeleton: false
journey_type: dev_pipeline
---
# Contract DoD — Workstream 1: 写 Walking Skeleton noop 实证笔记

**范围**: generator 节点产出 `docs/learnings/w8-langgraph-v15-e2e.md`，作为本次 LangGraph harness e2e 真闭环验证的 walking-skeleton 物证。严禁改动 packages/brain、packages/engine、packages/workflows 任何运行时代码或配置。
**大小**: S
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] docs/learnings/w8-langgraph-v15-e2e.md 文件存在
  Test: node -e "require('fs').accessSync('docs/learnings/w8-langgraph-v15-e2e.md')"

- [ ] [ARTIFACT] 首行包含 sprint 标识符 `W8 v15 LangGraph E2E 实证`
  Test: node -e "const c=require('fs').readFileSync('docs/learnings/w8-langgraph-v15-e2e.md','utf8');if(!c.split('\n')[0].includes('W8 v15 LangGraph E2E 实证'))process.exit(1)"

- [ ] [ARTIFACT] 文件含 journey_type=dev_pipeline 元数据
  Test: node -e "const c=require('fs').readFileSync('docs/learnings/w8-langgraph-v15-e2e.md','utf8');if(!/journey_type[:\s]+dev_pipeline/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 文件含 KR 对齐句（W8 / LangGraph / status=completed 三关键词）
  Test: node -e "const c=require('fs').readFileSync('docs/learnings/w8-langgraph-v15-e2e.md','utf8');if(!c.includes('W8')||!c.includes('LangGraph')||!c.includes('status=completed'))process.exit(1)"

- [ ] [ARTIFACT] 文件含 H7–H13 修复链路引用（至少 5 个 H 编号）
  Test: node -e "const c=require('fs').readFileSync('docs/learnings/w8-langgraph-v15-e2e.md','utf8');const hits=(c.match(/H(7|8|9|10|11|12|13)/g)||[]).length;if(hits<5)process.exit(1)"

- [ ] [ARTIFACT] 文件含 4 项实证字段占位（node_durations / gan_proposer_rounds / pr_url / run_date）
  Test: node -e "const c=require('fs').readFileSync('docs/learnings/w8-langgraph-v15-e2e.md','utf8');for(const k of ['node_durations','gan_proposer_rounds','pr_url','run_date'])if(!c.includes(k))process.exit(1)"

- [ ] [ARTIFACT] 严禁改动运行时代码：本次 PR 不应修改 packages/brain、packages/engine、packages/workflows 下任何文件
  Test: bash -c 'CHANGED=$(git diff --name-only origin/main...HEAD | grep -E "^packages/(brain|engine|workflows)/" | wc -l); [ "$CHANGED" -eq 0 ] || { echo "runtime files changed: $CHANGED"; exit 1; }'

## BEHAVIOR 索引（实际测试在 tests/ws1/）

见 `tests/ws1/walking-skeleton.test.ts`，覆盖：
- 文件存在且 fs.readFileSync 不抛 ENOENT，长度 > 0
- 首行（去 markdown header 前缀后）精确包含 `W8 v15 LangGraph E2E 实证`
- markdown 内容含 `journey_type` + `dev_pipeline` 字段
- 4 项实证字段（node_durations / gan_proposer_rounds / pr_url / run_date）占位齐全
