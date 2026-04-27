# Gate 3 + Gate 2 设计文档 — Brain HTTP 自动部署

**日期**: 2026-04-27  
**分支**: cp-0427185920-gate3-brain-autodeploy-http

---

## 背景

旧 brain-deploy.yml（SSH 方式）在 PR #2675 合并后立即失败（BRAIN_DEPLOY_SSH_KEY 为空），并于 PR #2678 撤销。现需要实现正确的 Gate 3（HTTP 自动部署）和 Gate 2（失败告警）。

## 架构设计

### Gate 3：Brain HTTP 自动部署

**文件**: `.github/workflows/brain-ci-deploy.yml`

**触发条件**:
```yaml
on:
  push:
    branches: [main]
    paths:
      - 'packages/brain/**'
      - 'scripts/brain-deploy.sh'
```

**并发策略**: `group: brain-autodeploy, cancel-in-progress: true`
- 与 deploy.yml 的 `deploy-production` group 完全隔离
- 多个连续 brain merge → 取消前者，只跑最新（含所有累积变更）

**部署流程**:
1. 计算 `changed_paths`（从 push event 的 before/after）
2. `POST /api/brain/deploy` with DEPLOY_TOKEN（与 deploy.yml fast lane 相同）
3. 处理 409：视为"deploy 正在进行，跳过"（非失败）— 防止 Gate 3 + deploy.yml 同时触发时冲突
4. Poll `/api/brain/deploy/status`（max 300s）
5. Smoke：`GET /api/brain/health`

### Gate 2：失败告警

**位置**: 同一 workflow 的 `on_failure` job

**行为**:
- `POST /api/brain/tasks`：创建 P0 hotfix 告警任务
- 不创建 revert PR（防止盲目 revert 正确代码）
- Brain 不可达时 `::warning::` 降级，不让 CI 失败

## 边界情况

| 场景 | 处理 |
|------|------|
| deploy.yml + Gate 3 同时触发 | Brain 返回 409，Gate 3 跳过（exit 0） |
| Brain 不可达（宕机） | Gate 3 deploy 触发失败 → Gate 2 创 P0 任务 → Brain 不可达则 `::warning::` |
| 连续 5 次 merge | cancel-in-progress:true，只跑最后一次 |

## 测试策略

- **DoD 验证（smoke.sh）**: `node -e` 检查 workflow 文件存在且含关键配置
- **CI lint**: 现有 lint-feature-has-smoke 验证 smoke.sh 存在

