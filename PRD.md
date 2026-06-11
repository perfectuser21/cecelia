# PRD — skill-drift 端点尊重 process.env.REPO_ROOT（修生产 snapshot_version 全 null）

## 背景

刚 merge 的 #3338 `GET /api/brain/harness/skill-drift` 在生产容器里 6 个 skill 的 `snapshot_version` 全 null、`any_drift` 恒 true。根因：snapshotDir 默认 `join(REPO_ROOT, 'packages','workflows','skills')`，而模块级 `REPO_ROOT = new URL('../../../..', import.meta.url)` 由模块路径算 → Brain 镜像里是 `/app`，`/app` 下无 packages/workflows（docker exec 实证）。但 deploy（docker-compose.yml）已把宿主 repo 以绝对路径挂进容器（line 34/54）并设 env `REPO_ROOT=/Users/administrator/perfect21/cecelia`（line 85）；SSOT 侧之所以正常，是因为它走 `homedir()`（Dockerfile ENV HOME 对齐宿主）→ 命中挂载。

## 方案选择

team-lead 给①部署注入 SKILLS_SNAPSHOT_DIR / ②代码 fallback 二选一。采用**代码侧、复用现成 env 惯例**：`process.env.REPO_ROOT || 模块计算值`——这是仓库既有惯例（zombie-cleaner.js / emergency-cleanup.js / startup-recovery.js 都这么写），且 deploy 已设好该 env + 挂载，无需改部署配置、无硬编码路径，比硬编码挂载绝对路径更干净。

## 范围

`packages/brain/src/routes/harness.js` 的 `/skill-drift`：snapshotDir 默认从 `process.env.REPO_ROOT || REPO_ROOT` 派生。其余不动。

## 成功标准

- 容器内（REPO_ROOT env 指向已挂载宿主 repo）snapshot_version 读到非 null。
- SKILLS_SNAPSHOT_DIR 显式覆盖仍优先；本地无 env 时回退模块计算值（本地/CI 正常）。
- 部署后 curl 端点：snapshot_version 全非 null 且 any_drift=false（当前 SSOT 与快照版本一致）。
