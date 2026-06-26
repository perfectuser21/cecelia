# Learning: harness 内部线 staging→promote 接缝对齐 dashboard（A 方案）

## 背景
harness 端到端从没真正走通 promote。夜间 ultrathink + systematic-debugging 挖出 promote 这一环三层叠加的根因，且第三层是架构错配（不是孤立 bug）。

## 根本原因
1. **路径 bug**：`staging-e2e-runner.js` handlePromote 用裸 `getRepoRoot()`（`path.resolve(thisDir,'../../..')` 在容器内 = `/`）→ 跑 `/scripts/promote-dashboard.sh` 不存在 → promote 直接抛错。同文件 deployStaging 早已用 `process.env.REPO_ROOT` 绕开，但 promote 路径漏改。
2. **自杀 bug**：`staging-promote.js` defaultPromoteExec 跑 promote-dashboard.sh 没设 `CECELIA_SKIP_BRAIN_PROMOTE=1`，脚本默认会跑 brain-deploy 重启 Brain 容器，而 harness promote 正在该容器内执行 → 重启自己 → pipeline 自杀（容器实测有 docker.sock，真会发生）。
3. **架构错配（根本）**：staging 步验 brain（:5222 via staging-deploy.sh），promote 步却调 dashboard 的 promote-dashboard.sh（硬依赖 `.staging-pending`，无则 exit 1），而 harness 流程从不产生 `.staging-pending` → promote 必败。staging（brain）与 promote（dashboard）语义不匹配。

## 修法（A 方案：内部线交付物 = dashboard，主理人决策）
- deployStaging 内部线走 `deploy-local.sh --changed=apps/dashboard`（构建 dashboard 到 staging :5223 + 写 .staging-pending），返回 stagingPort。
- staging E2E 用 deploy 返回的 stagingPort（内部线打 5223）。
- promote 修路径（用 REPO_ROOT）+ 自杀（注入 SKIP_BRAIN_PROMOTE）。此时 .staging-pending 由 staging 步产生，promote-dashboard.sh 能跑通换 5211。

## 下次预防
- 改 staging↔promote 任一端时，必须确认两端"验什么/发什么"语义一致（同一交付物），别一端 brain 一端 dashboard。
- 跨容器执行部署脚本时，凡涉及"脚本会重启当前进程所在容器"的，必须有 SKIP 钩子并默认跳过自重启。
- 容器内取 repo 路径一律 `process.env.REPO_ROOT || getRepoRoot()`，禁止裸 `getRepoRoot()`（容器内返回 /）。

## checklist
- [ ] 改 staging 或 promote 时，确认两端交付物语义一致
- [ ] promote/部署脚本跨容器执行时，确认不会重启执行它自己的容器（SKIP 钩子）
- [ ] 容器内取 repo 路径用 REPO_ROOT env，不裸 getRepoRoot()
- [ ] B（brain 交付）/C（智能判断）后续：staging 验 brain 时 promote 走 brain-deploy，需解 langgraph resume
