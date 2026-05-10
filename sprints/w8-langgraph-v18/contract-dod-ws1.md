---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: 触发 + 监视 + 收证 + 写 harness-report.md

**范围**: 在 Generator 容器内触发一个最小子 `harness_initiative`、轮询到终态、收集 4 类证据、写 `sprints/w8-langgraph-v18/harness-report.md`、commit + push。**不修改 `packages/brain/src/`**。
**大小**: M
**依赖**: 无

## ARTIFACT 条目（仅静态产出物，运行时行为见 BEHAVIOR 索引）

- [ ] [ARTIFACT] `sprints/w8-langgraph-v18/harness-report.md` 文件存在
  Test: `test -f sprints/w8-langgraph-v18/harness-report.md`

- [ ] [ARTIFACT] 报告 frontmatter 含合法 UUID v4 格式的 `child_initiative_id` 字段
  Test: `awk '/^child_initiative_id:/ {print $2}' sprints/w8-langgraph-v18/harness-report.md | grep -E '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`

- [ ] [ARTIFACT] 报告含 `## Final Status` 章节
  Test: `grep -q '^## Final Status' sprints/w8-langgraph-v18/harness-report.md`

- [ ] [ARTIFACT] 报告含 `## Evaluator Verdict` 章节
  Test: `grep -q '^## Evaluator Verdict' sprints/w8-langgraph-v18/harness-report.md`

- [ ] [ARTIFACT] 报告含 `## Subtask Summary` 章节
  Test: `grep -q '^## Subtask Summary' sprints/w8-langgraph-v18/harness-report.md`

- [ ] [ARTIFACT] 报告含 `## Evidence` 章节（指向 task JSON / 子任务 SQL / stdout 关键词扫描结果）
  Test: `grep -q '^## Evidence' sprints/w8-langgraph-v18/harness-report.md`

- [ ] [ARTIFACT] 报告含 `## Residual Issues` 章节（哪怕本次"无残留"也强制写一段，禁止隐瞒）
  Test: `grep -q '^## Residual Issues' sprints/w8-langgraph-v18/harness-report.md`

- [ ] [ARTIFACT] 报告含至少 1 条 `https://github.com/.../pull/N` 形式的 PR URL
  Test: `grep -oE 'https://github\.com/[^/]+/[^/]+/pull/[0-9]+' sprints/w8-langgraph-v18/harness-report.md | head -1`

- [ ] [ARTIFACT] 本 Sprint 的 Generator 提交不修改 `packages/brain/src/`（只读约束）
  Test: `git diff --name-only origin/main... -- 'packages/brain/src/' | (! read -r line)`

## BEHAVIOR 索引（实际测试在 tests/ws1/）

见 `tests/ws1/harness-report-evidence.test.ts`，覆盖：
- `child_initiative_id` 是合法 UUID v4（不仅是 36 字符任意串）
- `Final Status` 段落明确出现 `completed`
- `Evaluator Verdict` 段落明确出现 `APPROVED`
- 至少 1 条 `https://github.com/.../pull/N` 形式的 PR URL
- `Subtask Summary` 列出 ≥4 个 `harness_*` task_type 且全 completed，无任何 failed/stuck 字样
