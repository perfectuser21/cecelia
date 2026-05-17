# Learning: Staging 环境搭建 + Safe Lane 接入

**Branch**: cp-04052055-cp-04051454-staging-env
**Date**: 2026-04-05

---

### 根本原因

Safe Lane（risk_level=high）原来直接 exit 1 阻断部署，没有 staging 缓冲层。
高风险的 Brain 核心文件改动（thalamus/tick/executor 等）改完后没有安全的验证环境，只能手动本地跑。

### 修复内容

1. **`docker-compose.staging.yml`**：Brain staging 实例，端口 5222，独立 DB（cecelia_staging），tick 禁用
2. **`scripts/staging-deploy.sh`**：复用 production 镜像，对 cecelia_staging 跑 migrate，启动 staging 容器
3. **`scripts/staging-verify.sh`**：四项 smoke test（health/tick/tick-disabled/tasks），退出码驱动 CI
4. **`deploy.yml` 架构变更**：
   - `risk_gate` 改为仅 Fast Lane 执行（`if: risk_level == 'low'`），不再 Safe Lane exit 1
   - 新增 `staging_deploy` job，仅 Safe Lane 执行，包含 staging 部署 + smoke test
   - `deploy` (production) job 用 `always()` + 条件逻辑，两种 lane 都能触发

### 关键设计决策

**GitHub Actions `needs` + `always()` 多路 lane 模式**：
当两个 job（risk_gate / staging_deploy）互相跳过时，需要用 `always()` 解除 skipped 的传播阻断，
再在 `if` 条件里精确判断哪个 lane 通过。否则 `needs.job.result == 'skipped'` 会导致下游 job 也 skipped。

```yaml
deploy:
  needs: [changes, risk_gate, staging_deploy]
  if: |
    always() &&
    (... brain or workspace changed ...) &&
    (
      (risk_level == 'low' && risk_gate.result == 'success') ||
      (risk_level == 'high' && staging_deploy.result == 'success')
    )
```

**staging DB 方案**：同 postgres 实例，不同 database（cecelia_staging）。最简单，不需要额外容器。
**staging tick 禁用**：CECELIA_TICK_ENABLED=false，防止 staging 与 production 竞争任务派发。

### 下次预防

- [ ] 新增高风险文件（SAFE_LANE_PATTERN）时，同步确认 staging 能覆盖该文件的 smoke test
- [ ] staging DB 需要提前存在（staging-deploy.sh 会自动创建，但需要 psql 客户端）
- [ ] .env.staging 参考 .env.staging.example 手动创建，不提交 git
- [ ] staging_deploy job webhook 调用传 `staging: true` 参数，Brain 端需要支持该参数路由到 staging 部署

### 注意事项

- `staging_deploy` smoke test 用了 `${BRAIN_URL%:*}:5222` 提取 host，仅适合 URL 无路径的情况（当前 BRAIN_URL 是域名格式）
- staging 容器 `restart: "no"`，避免 staging 失败后反复重启干扰 production
- production deploy job 的 webhook 不传 `staging: true`，复用现有 Brain `/api/brain/deploy` 端点
