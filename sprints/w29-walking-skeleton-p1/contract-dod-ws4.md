---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 4: Acceptance report

**范围**: 新建 `sprints/w29-walking-skeleton-p1/acceptance-report.md`，汇总 B1–B7 7 项修复 + 每项的修复 PR + 在本次整合 smoke 中对应的 Step 号（Step 1-8）+ smoke 输出片段引用占位（合并 PR 时回填真实 smoke 输出快照）+ CI 集成方式说明（`.github/workflows/ci.yml` 的 `real-env-smoke` job 已通过 glob `packages/brain/scripts/smoke/*.sh` 自动包含本 smoke，无需追加 workflow step；PRD "在 brain-ci.yml 增加 step" 的 intent 因此自动满足）。

**大小**: S（≈ 50 行 markdown）
**依赖**: WS3（smoke 文件已完整，方可在报告中引用 Step 号）

## SSOT 协议（同 WS1/WS2/WS3）

本 WS 的 BEHAVIOR Test 直接 grep 报告 markdown 文件内容（报告就是 deliverable，无运行时维度）。

## ARTIFACT 条目

- [ ] [ARTIFACT] 报告文件存在
  Test: `bash -c '[ -f sprints/w29-walking-skeleton-p1/acceptance-report.md ]'`
  期望: exit 0

- [ ] [ARTIFACT] 报告标题含 W29 + Walking Skeleton P1 关键字
  Test: `bash -c 'grep -qE "W29|Walking Skeleton P1" sprints/w29-walking-skeleton-p1/acceptance-report.md'`
  期望: exit 0

## BEHAVIOR 条目（直接对报告 markdown grep；evaluator 真执行）

- [ ] [BEHAVIOR] [ws4-coverage-b1-b7] 报告覆盖 B1–B7 全部 7 项修复（每项至少 1 次引用）
  Test: manual:bash -c 'F=sprints/w29-walking-skeleton-p1/acceptance-report.md; for b in B1 B2 B3 B4 B5 B6 B7; do grep -q "$b" "$F" || { echo "FAIL: missing $b"; exit 1; }; done'
  期望: exit 0

- [ ] [BEHAVIOR] [ws4-smoke-ref] 报告引用本次整合 smoke 文件路径 `walking-skeleton-p1-acceptance-smoke`
  Test: manual:bash -c 'grep -q "walking-skeleton-p1-acceptance-smoke" sprints/w29-walking-skeleton-p1/acceptance-report.md'
  期望: exit 0

- [ ] [BEHAVIOR] [ws4-ci-integration-note] 报告含 CI 集成方式说明（提到 real-env-smoke 自动 glob 包含 + 无需追加 workflow step）
  Test: manual:bash -c 'grep -qE "real-env-smoke" sprints/w29-walking-skeleton-p1/acceptance-report.md && grep -qE "glob|自动包含|无需追加" sprints/w29-walking-skeleton-p1/acceptance-report.md'
  期望: exit 0

- [ ] [BEHAVIOR] [ws4-pass-signal-literal] 报告含字面值 `[walking-skeleton-p1-终验] PASS — 7 项 P1 修复全链路联调通过`（用于 PR description 直链）
  Test: manual:bash -c 'grep -q "\[walking-skeleton-p1-终验\] PASS — 7 项 P1 修复全链路联调通过" sprints/w29-walking-skeleton-p1/acceptance-report.md'
  期望: exit 0

- [ ] [BEHAVIOR] [ws4-step-mapping] 报告含每项 B1-B7 对应的 smoke Step 号映射（Step 1-8 至少各 1 次出现，或一张映射表）
  Test: manual:bash -c 'F=sprints/w29-walking-skeleton-p1/acceptance-report.md; for s in 1 2 3 4 5 6 7 8; do grep -qE "Step[[:space:]]+$s\b|Step $s\b" "$F" || { echo "FAIL: missing Step $s"; exit 1; }; done'
  期望: exit 0

- [ ] [BEHAVIOR] [ws4-pr-evidence-placeholder] 报告每项 B1-B7 段含 smoke 输出片段引用占位（如 `<smoke 输出>` / `<待回填>` / 代码块），合并 PR 时回填
  Test: manual:bash -c 'F=sprints/w29-walking-skeleton-p1/acceptance-report.md; grep -qE "<smoke 输出>|<待回填>|<TBD>|\`\`\`" "$F"'
  期望: exit 0
