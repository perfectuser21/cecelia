---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 3: 验收脚本 + 报告 generator

**范围**：写实环境跑的 acceptance bash 脚本 + 报告生成器（从 PG/docker 拉真实数据，产出 `acceptance-report.md`），并产出报告模板。
**大小**：M
**依赖**：Workstream 2（集成测试 PASS 证明 graph 行为正确，再上实环境跑）

## ARTIFACT 条目

- [ ] [ARTIFACT] `sprints/w8-langgraph-v8/scripts/run-acceptance.sh` 文件存在且可执行
  Test: `test -x sprints/w8-langgraph-v8/scripts/run-acceptance.sh`

- [ ] [ARTIFACT] `run-acceptance.sh` 含 `set -euo pipefail`（任何一步失败立即退出）
  Test: `grep -q '^set -euo pipefail' sprints/w8-langgraph-v8/scripts/run-acceptance.sh`

- [ ] [ARTIFACT] `run-acceptance.sh` 至少 5 处 psql 查询带时间窗口约束（防造假）
  Test: `node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v8/scripts/run-acceptance.sh','utf8');const m=c.match(/interval '/g);process.exit((m||[]).length>=5?0:1)"`

- [ ] [ARTIFACT] `run-acceptance.sh` 含 `docker restart brain` 触发 kill/resume 实证
  Test: `grep -q 'docker restart brain' sprints/w8-langgraph-v8/scripts/run-acceptance.sh`

- [ ] [ARTIFACT] `sprints/w8-langgraph-v8/scripts/generate-report.mjs` 文件存在
  Test: `test -f sprints/w8-langgraph-v8/scripts/generate-report.mjs`

- [ ] [ARTIFACT] `generate-report.mjs` 支持 DRY_RUN=1 不连 PG 也能输出 sample 报告
  Test: `node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v8/scripts/generate-report.mjs','utf8');if(!/DRY_RUN/.test(c))process.exit(1)"`

- [ ] [ARTIFACT] `sprints/w8-langgraph-v8/acceptance-report.template.md` 模板存在
  Test: `test -f sprints/w8-langgraph-v8/acceptance-report.template.md`

- [ ] [ARTIFACT] 模板含 14 节点轨迹表的表头骨架（`| 节点 | 进入时间 | 出口状态 |`）
  Test: `grep -q '| 节点 | 进入时间 | 出口状态 |' sprints/w8-langgraph-v8/acceptance-report.template.md`

## BEHAVIOR 索引（实际测试在 tests/ws3/）

见 `tests/ws3/report-generator.test.ts`，覆盖：
- `generate-report.mjs` 在 DRY_RUN=1 下运行不连 PG 输出含 14 行 node 轨迹的 markdown
- 接 `--task-id <uuid>` 参数后产出 markdown 含该 UUID 字面量
- 报告内不含 `TODO` / `<placeholder>` / `待填` / `tbd` 字面量（`generate-report` 必须把模板里的占位全部替换或删除）
- `run-acceptance.sh` 文本含 `set -euo pipefail`
- `run-acceptance.sh` 文本中 `interval '` 出现 ≥ 5 次（5 处时间窗口约束）
