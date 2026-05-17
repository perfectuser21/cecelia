# PRD: PR-D — executor 真路径 smoke

## 背景

100% foundation 路线 PR-D。4 agent 审计找出 executor.js 3620 行核心调度引擎 0 真 smoke 覆盖。spawn 真路径需 cecelia-bridge 不在 CI clean docker 范围，但纯函数（路由表 / UUID / model / provider）可通过 docker exec node -e 直调验证契约。

学 PR-B dispatcher-real-paths.sh 的 docker exec 模式（已被 post-deploy 验证有效）。

## 范围

### 一、`packages/brain/scripts/smoke/executor-pure-functions.sh`（130 行，5 case）

- **Case A**: `getSkillForTaskType` 路由表（dev/talk/review 必返非空 + 含 task_type 关键字）
- **Case B**: `getSkillForTaskType` decomposition payload 优先级（payload.decomposition='true' + dev → /decomp）
- **Case C**: `generateRunId` 返合法 UUID v4 格式
- **Case D**: `getProviderForTask` 5 个 task_type 全不抛
- **Case E**: `checkTaskTypeMatch` 稳定不抛

container 自动检测 cecelia-brain-smoke (CI) / cecelia-node-brain (本机)。

### 二、real-env-smoke + post-deploy 自动跑

无需改 ci.yml — 新 smoke 自动纳入 packages/brain/scripts/smoke/*.sh 通配。

### 三、Engine 18.12.0 → 18.13.0

## 验收

- 本地 5/5 pass
- CI real-env-smoke 也跑过（cecelia-brain-smoke container）
- 后续 executor.js 改动如果破坏路由表 / UUID / provider 契约，CI 立刻拒
