---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: 触发 + 监视 + 收证 + 写 harness-report.md + 落盘 child-prd.md

**范围**: 在 Generator 容器内反查 STDOUT_FILE 路径、按附录 §A 模板写 child PRD 并落盘、`POST /api/brain/tasks` 创建最小子 `harness_initiative`（请求体 `metadata.parent_initiative_id="$TASK_ID"`）、轮询到终态、收集证据、写 `sprints/w8-langgraph-v18/harness-report.md` + `child-prd.md`、commit + push。**不修改 `packages/brain/src/`**。
**大小**: M
**依赖**: 无

## ARTIFACT 条目（仅静态产出物，运行时行为见 BEHAVIOR 索引）

- [ ] [ARTIFACT] `sprints/w8-langgraph-v18/harness-report.md` 文件存在
  Test: `test -f sprints/w8-langgraph-v18/harness-report.md`

- [ ] [ARTIFACT] 报告 frontmatter 含合法 UUID v4 格式的 `child_initiative_id` 字段
  Test: `awk '/^child_initiative_id:/ {print $2}' sprints/w8-langgraph-v18/harness-report.md | grep -E '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`

- [ ] [ARTIFACT] 报告 frontmatter 含 `parent_initiative_id` 字段（非空，留待 E2E 比对 $TASK_ID）
  Test: `awk '/^parent_initiative_id:/ {print $2}' sprints/w8-langgraph-v18/harness-report.md | grep -E '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`

- [ ] [ARTIFACT] 报告 frontmatter 含 `stdout_file` 字段，值指向真实存在的文件（risk 4 mitigation）
  Test: `path=$(awk '/^stdout_file:/ {print $2}' sprints/w8-langgraph-v18/harness-report.md); test -n "$path" && test -f "$path"`

- [ ] [ARTIFACT] 报告含 `## Final Status` 章节
  Test: `grep -q '^## Final Status' sprints/w8-langgraph-v18/harness-report.md`

- [ ] [ARTIFACT] 报告含 `## Evaluator Verdict` 章节
  Test: `grep -q '^## Evaluator Verdict' sprints/w8-langgraph-v18/harness-report.md`

- [ ] [ARTIFACT] 报告含 `## Subtask Summary` 章节
  Test: `grep -q '^## Subtask Summary' sprints/w8-langgraph-v18/harness-report.md`

- [ ] [ARTIFACT] 报告含 `## Evidence` 章节（指向 task JSON / 子任务 SQL / stdout 关键词扫描结果 / `gh pr view` 片段）
  Test: `grep -q '^## Evidence' sprints/w8-langgraph-v18/harness-report.md`

- [ ] [ARTIFACT] 报告含 `## Residual Issues` 章节（哪怕本次"无残留"也强制写一段，禁止隐瞒）
  Test: `grep -q '^## Residual Issues' sprints/w8-langgraph-v18/harness-report.md`

- [ ] [ARTIFACT] 报告含至少 1 条 `https://github.com/.../pull/N` 形式的 PR URL
  Test: `grep -oE 'https://github\.com/[^/]+/[^/]+/pull/[0-9]+' sprints/w8-langgraph-v18/harness-report.md | head -1`

- [ ] [ARTIFACT] `sprints/w8-langgraph-v18/child-prd.md` 文件存在（risk 1 mitigation）
  Test: `test -f sprints/w8-langgraph-v18/child-prd.md`

- [ ] [ARTIFACT] child-prd.md 含 `## 场景描述` 段
  Test: `grep -q '^## 场景描述' sprints/w8-langgraph-v18/child-prd.md`

- [ ] [ARTIFACT] child-prd.md 含 `## Golden Path` 段
  Test: `grep -q '^## Golden Path' sprints/w8-langgraph-v18/child-prd.md`

- [ ] [ARTIFACT] child-prd.md 含 `## DoD 命令清单` 段
  Test: `grep -q '^## DoD 命令清单' sprints/w8-langgraph-v18/child-prd.md`

- [ ] [ARTIFACT] child-prd.md `## DoD 命令清单` 段含 ≥1 个可执行 ```bash 代码块
  Test: `awk '/^## DoD 命令清单/,/^## /' sprints/w8-langgraph-v18/child-prd.md | grep -q '^```bash'`

- [ ] [ARTIFACT] 本 Sprint 的 Generator 提交不修改 `packages/brain/src/`（只读约束）
  Test: `git diff --name-only origin/main... -- 'packages/brain/src/' | (! read -r line)`

## BEHAVIOR 索引（实际测试在 tests/ws1/）

见 `tests/ws1/harness-report-evidence.test.ts`，覆盖：
- `child_initiative_id` 是合法 UUID v4（不仅是 36 字符任意串）
- `Final Status` 段落明确出现 `completed`
- `Evaluator Verdict` 段落明确出现 `APPROVED`
- 至少 1 条 `https://github.com/.../pull/N` 形式的 PR URL
- `Subtask Summary` 列出 ≥4 个 `harness_*` task_type 且全 completed，无任何 failed/stuck 字样

> 注：`metadata.parent_initiative_id == $TASK_ID` / `state == MERGED` / commit message 含 child_initiative_id 前 8 位 / `stdout_file` 指向真实文件 / child-prd 三段模板 — 这 5 项 risk-driven 校验涉及 Brain API + GitHub API + 文件系统，留给 Step 1/3 + E2E §2/§5/§8/§9 的可执行验证命令做强校验，不进 BEHAVIOR 单测（避免单测联网与基础设施耦合）。
