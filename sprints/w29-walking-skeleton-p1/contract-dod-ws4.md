---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 4: Acceptance report

**范围**: 新建 `sprints/w29-walking-skeleton-p1/acceptance-report.md`，汇总 B1–B7 7 项修复 + 每项的修复 PR + 在本次整合 smoke 中对应的验证 Step 号 + smoke 输出片段占位 + CI 集成方式说明（`.github/workflows/ci.yml` 的 `real-env-smoke` job 已用 glob `packages/brain/scripts/smoke/*.sh` 自动包含本 smoke，无需追加 workflow step；PRD "在 brain-ci.yml 增加 step" 的 intent 因此自动满足）。
**大小**: S（≈ 50 行 markdown）
**依赖**: WS3（smoke 文件已完整，方可在报告中引用 Step 号）

## ARTIFACT 条目

- [ ] [ARTIFACT] 报告文件存在
  Test: `bash -c '[ -f sprints/w29-walking-skeleton-p1/acceptance-report.md ]'`
  期望: exit 0

- [ ] [ARTIFACT] 报告标题含 W29 + Walking Skeleton P1 关键字
  Test: `bash -c 'grep -E "W29|Walking Skeleton P1" sprints/w29-walking-skeleton-p1/acceptance-report.md'`
  期望: 输出至少 1 行

## BEHAVIOR 条目

- [ ] [BEHAVIOR] 报告覆盖 B1–B7 全部 7 项修复（每项至少 1 次引用）
  Test: manual:bash -c 'F=sprints/w29-walking-skeleton-p1/acceptance-report.md; for b in B1 B2 B3 B4 B5 B6 B7; do grep -q "$b" "$F" || { echo "miss $b"; exit 1; }; done; echo OK'
  期望: 输出 `OK`

- [ ] [BEHAVIOR] 报告引用本次整合 smoke 文件路径 walking-skeleton-p1-acceptance-smoke.sh
  Test: manual:bash -c 'grep -q "walking-skeleton-p1-acceptance-smoke" sprints/w29-walking-skeleton-p1/acceptance-report.md'
  期望: exit 0

- [ ] [BEHAVIOR] 报告含 CI 集成方式说明（提到 real-env-smoke 自动 glob 包含）
  Test: manual:bash -c 'grep -E "real-env-smoke|glob.*smoke/\*.sh|自动包含|自动 glob" sprints/w29-walking-skeleton-p1/acceptance-report.md'
  期望: 输出至少 1 行

- [ ] [BEHAVIOR] 报告标明本次终验 PASS 信号字符串（用于 PR description 链接）
  Test: manual:bash -c 'grep -q "PASS — 7 项 P1 修复全链路联调通过" sprints/w29-walking-skeleton-p1/acceptance-report.md'
  期望: exit 0

- [ ] [BEHAVIOR] 报告含每项 B1-B7 对应的 smoke Step 号映射（Step 1-8 至少出现 1 次）
  Test: manual:bash -c 'grep -E "Step[[:space:]]+[1-8]" sprints/w29-walking-skeleton-p1/acceptance-report.md | head -1'
  期望: 输出至少 1 行
