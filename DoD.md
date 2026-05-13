contract_branch: cp-harness-propose-r2-4271d19c
workstream_index: 2
sprint_dir: sprints/w41-walking-skeleton-final-b19

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 2: verification-report.md 写作

**范围**: 读 evidence/，产出含 5 类证据章节的 verification-report.md
**大小**: S（< 100 行）
**依赖**: WS1 完成

## ARTIFACT 条目

- [ ] [ARTIFACT] verification-report.md 存在且非空
  Test: bash -c '[ -s sprints/w41-walking-skeleton-final-b19/verification-report.md ]'

- [ ] [ARTIFACT] report 末尾含 ## 结论 段
  Test: bash -c 'grep -q "^## 结论" sprints/w41-walking-skeleton-final-b19/verification-report.md'

## BEHAVIOR 条目（内嵌可执行 manual:bash 命令）

- [ ] [BEHAVIOR] report 含 5 个指定章节标题字面值（H2 级）
  Test: manual:bash -c 'set -e; R=sprints/w41-walking-skeleton-final-b19/verification-report.md; for S in "B19 fix evidence" "PR_BRANCH 传递" "evaluator 在 PR 分支" "fix 循环触发证据" "task completed 收敛"; do grep -qF "$S" "$R" || { echo "缺章节 $S"; exit 1; }; done'
  期望: exit 0

- [ ] [BEHAVIOR] report 含至少 1 个可点 GitHub PR URL（匹配 https://github.com/.+/pull/N 格式）
  Test: manual:bash -c 'grep -qE "https://github\.com/[^/]+/[^/]+/pull/[0-9]+" sprints/w41-walking-skeleton-final-b19/verification-report.md'
  期望: exit 0

- [ ] [BEHAVIOR] report 引用的 PR URL 与 evidence/pr-url-trace.txt 中的 url 字面一致（防贴占位 URL 假装跑过）
  Test: manual:bash -c 'set -e; R=sprints/w41-walking-skeleton-final-b19/verification-report.md; T=sprints/w41-walking-skeleton-final-b19/evidence/pr-url-trace.txt; TRACE_URL=$(awk "{for(i=1;i<=NF;i++)if(\$i~/^pr_url=/)print substr(\$i,8)}" "$T" | sort -u | head -1); grep -qF "$TRACE_URL" "$R"'
  期望: exit 0

- [ ] [BEHAVIOR] report 含 git rev-parse 比对原始输出（HEAD vs origin/main 的两个 sha 字面）
  Test: manual:bash -c 'set -e; R=sprints/w41-walking-skeleton-final-b19/verification-report.md; P=sprints/w41-walking-skeleton-final-b19/evidence/evaluator-checkout-proof.txt; HEAD=$(grep -E "^evaluator_HEAD=" "$P" | head -1 | cut -d= -f2); grep -qF "$HEAD" "$R" || { echo "report 未引用 evaluator HEAD sha $HEAD"; exit 1; }'
  期望: exit 0

- [ ] [BEHAVIOR] report 结论段含 B14–B19 协同生效的明确判定文字（含 "B19" 字面值 + "生效" 或 "未生效" 字面值之一）
  Test: manual:bash -c 'set -e; R=sprints/w41-walking-skeleton-final-b19/verification-report.md; awk "/^## 结论/,/^##[^#]/" "$R" | grep -q "B19" && (awk "/^## 结论/,/^##[^#]/" "$R" | grep -qE "(真|已)生效|未生效|失效")'
  期望: exit 0
