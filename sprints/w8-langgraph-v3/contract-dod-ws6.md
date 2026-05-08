---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 6: 最终验证 + 报告生成 + KR 回写

**范围**: 实现 `sprints/harness-acceptance-v3/scripts/06-final-report.sh` + `sprints/harness-acceptance-v3/lib/render-report.mjs`，校验 health endpoint live、子 dev task PR merged、KR 进度增量，渲染 acceptance 报告 markdown，PATCH KR 回写。
**大小**: L
**依赖**: Workstream 5

## ARTIFACT 条目

- [ ] [ARTIFACT] 终验证脚本存在且可执行
  Test: test -x sprints/harness-acceptance-v3/scripts/06-final-report.sh

- [ ] [ARTIFACT] 报告渲染器存在且导出 `renderReport` / `verifyHealthEndpoint` / `verifyChildPrMerged` / `bumpKrProgress`
  Test: node -e "const m=require('./sprints/harness-acceptance-v3/lib/render-report.mjs');for(const k of ['renderReport','verifyHealthEndpoint','verifyChildPrMerged','bumpKrProgress']){if(typeof m[k]!=='function')process.exit(1)}"

- [ ] [ARTIFACT] 报告输出路径硬编码为 PRD 指定值
  Test: grep -F 'docs/superpowers/reports/2026-05-07-harness-langgraph-acceptance-v3.md' sprints/harness-acceptance-v3/scripts/06-final-report.sh sprints/harness-acceptance-v3/lib/render-report.mjs

- [ ] [ARTIFACT] 报告模板含 6 段固定章节标题（合同 Step 6 列举的章节名）
  Test: grep -E '## (Pre-flight 与派发|14 节点事件表|故障注入 A|故障注入 B|故障注入 C|最终验证)' sprints/harness-acceptance-v3/lib/render-report.mjs | wc -l | awk '$1>=6{exit 0} {exit 1}'

- [ ] [ARTIFACT] 报告模板含三段 timeline 字段 placeholder（注入时刻/反应时刻/自愈终态 各 3 次）
  Test: TLN=$(grep -cE '注入时刻|反应时刻|自愈终态' sprints/harness-acceptance-v3/lib/render-report.mjs); [ "$TLN" -ge 9 ]

- [ ] [ARTIFACT] LiveMonitor URL 模板存在
  Test: grep -E 'LiveMonitor.*localhost:5174/monitor|monitor\?task_id=' sprints/harness-acceptance-v3/lib/render-report.mjs

- [ ] [ARTIFACT] verifyChildPrMerged 调用 GitHub API（不只看 DB 里的字段）
  Test: grep -E 'gh api repos|api\.github\.com/repos' sprints/harness-acceptance-v3/lib/render-report.mjs

- [ ] [ARTIFACT] bumpKrProgress 幂等保护（先读后比再决定写）
  Test: grep -E 'idempotent|already.{0,20}>=|current_pct\s*>=' sprints/harness-acceptance-v3/lib/render-report.mjs

## BEHAVIOR 索引（实际测试在 tests/ws6/）

见 `sprints/w8-langgraph-v3/tests/ws6/final-report.test.ts`，覆盖：
- `renderReport(data)` 输出 markdown 含全部 6 段章节、3 段时间线（共 ≥9 行 timeline 字段）、LiveMonitor URL
- `verifyHealthEndpoint()` body 缺 `langgraph_version` 时抛错；`last_attempt_at` 早于 90 分钟前抛错
- `verifyChildPrMerged(prUrl)` 调用 GitHub API，merged=false 时抛错
- `bumpKrProgress(krKey, delta)` 当现进度 ≥ 目标 delta 时 no-op（幂等），否则发起 PATCH
