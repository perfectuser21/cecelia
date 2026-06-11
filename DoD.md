contract_branch: cp-harness-propose-r2-ea622a94
sprint_dir: sprints/06112200-report-scriptize

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: harness-report.mjs 脚本化（机械段下沉 + 幂等 + 宿主 git 隔离）

**范围**: `packages/brain/scripts/harness-report.mjs`（新增 CLI 脚本）+ `reportNode` 机械段改调脚本 + vitest 单测；修 stale：thickness:done → 移除 thickness、awk $NF → $2
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/scripts/harness-report.mjs` 存在，且含 CLI 参数解析（--sprint-dir / --task-id / --pr-url / --feature-id）
- [ ] [ARTIFACT] `packages/brain/scripts/harness-report.mjs` 含分步 try/catch（≥ 4 个 try 块）
- [ ] [ARTIFACT] `packages/brain/src/workflows/harness-initiative.graph.js` 的 reportNode 含 harness-report.mjs 调用
- [ ] [ARTIFACT] `packages/brain/src/__tests__/harness-report-script.test.js` 存在
- [ ] [ARTIFACT] 脚本不含 thickness:"done"（stale 已修）

## BEHAVIOR 条目

- [ ] [BEHAVIOR] 脚本文件存在，缺参数时输出 usage/error
- [ ] [BEHAVIOR] 脚本在 fixture sprint-dir 生成三文件（harness-report.md + learning.md + index.html）
- [ ] [BEHAVIOR] task status 变 completed
- [ ] [BEHAVIOR] feature status 变 done，thickness:done → 400
- [ ] [BEHAVIOR] notes POST 分步汇总含 notes 步骤输出；task PATCH 不受 notes 502 影响
- [ ] [BEHAVIOR] registry upsert 幂等（第二次后条目数不增）
- [ ] [BEHAVIOR] 宿主 git status + branch 前后完全一致
- [ ] [BEHAVIOR] sprint-prd.md 缺失时 WARN+跳过，task PATCH 仍成功
- [ ] [BEHAVIOR] 某步失败（feature 404）后续继续 + exit 1 + ❌ 汇总
