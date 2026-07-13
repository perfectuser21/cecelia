# Sprint PRD：Cecelia 三段常驻收尾

**Sprint ID**: 07131922-环境模型三段常驻收尾-cecelia-zenithjoy-4e5fd7eb
**Golden Path**: 4e5fd7eb-3823-4c57-a817-081b7fdd2eed
**Journey**: f5c82f8c-9650-401b-b1ab-8902940607ab
**Task**: d063b3e5-8fb1-4d53-b176-8e8198c7a084
**Target Environment**: local_api
**Review Required**: true
**Date**: 2026-07-13

---

## 1. 目标

补齐 Cecelia 三段常驻（develop 5220 / staging 5222 / production 5221）最后一公里，消除两个真实风险：

1. develop 分支 PR 合并后无自动联测环境，开发者靠手动起服务验证，若忘记直接进 staging，缺陷以更高代价被发现。
2. staging 宿主重启后 `restart: "no"` 导致自动恢复失效，若重启发生在周末/夜间，staging 护栏失效窗口可能持续数小时，下一次 main push 的安全验证将跑在"staging 已挂"状态下而无感知。

**范围边界**：仅 Cecelia monorepo（/workspace）侧变更。ZenithJoy develop 环境常驻**不在本 Sprint 范围**，需另立独立 GP。

---

## 2. 现状基线（代码级证据）

| 环境 | 端口 | 当前状态 | 差距 |
|------|------|---------|------|
| Cecelia Brain production | 5221 | 已完整常驻 | 无（对照基线） |
| Cecelia Brain staging | 5222 | CI 自动部署链路完整，但 `docker-compose.staging.yml` 第 79 行：`restart: "no"` | 宿主重启后不自动恢复 |
| Cecelia Brain develop | 5220 | `docker-compose.dev.yml` 已有 `node-brain-dev` 服务定义（端口 5220，`restart: unless-stopped`，healthcheck 已定义） | 无部署脚本、无 CI 自动化、无健康监控告警 |
| Dashboard staging | 5223 | 已有容器 | `docker-compose.yml` 蓝绿 canary 临时端口 `TEMP_PORT=5223`（`scripts/brain-deploy.sh` 第 305 行），并发时存在冲突风险 |
| ZenithJoy develop | — | Cecelia 侧无任何引用 | 范围外，需另立 GP |

---

## 3. 功能需求（FR）

### FR-1：修复 Cecelia Staging restart 策略

**文件**：`docker-compose.staging.yml`

- 将第 79 行 `restart: "no"` 改为 `restart: unless-stopped`
- 检查 staging 服务是否已有 `depends_on: {pg: {condition: service_healthy}}`；若无，补充并设置 `healthcheck.start_period: 30s`，确保容器等待 PostgreSQL 就绪后再启动，避免宿主重启时 Brain staging 在 pg 未就绪前反复 connect-failed 进入 backoff 状态

### FR-2：创建 dev-deploy.sh

**文件**：`scripts/dev-deploy.sh`

- 步骤对称 `staging-deploy.sh`：
  1. 检查 Docker 可用性（不可用 → exit 0 + `DEV_SKIP_REASON=no_docker`）
  2. 检查 `.env.docker` 或 `.env.dev`（不存在 → exit 0 + `DEV_SKIP_REASON=no_env`）
  3. 创建 `cecelia_dev` DB（已存在忽略错误）
  4. migrate 幂等检测：若 `.migrate-success-dev` 标志文件存在且 `schema_version` 最新版本匹配，跳过 migrate
  5. 若 DB 已存在（二次运行），先执行 `pg_dump cecelia_dev > /opt/cecelia-backups/cecelia_dev_backup_$(date +%Y%m%d%H%M%S).sql`
  6. 备份保留策略：`/opt/cecelia-backups/` 保留最近 7 个备份，超出自动清理最旧的
  7. 运行 migrations（针对 `cecelia_dev` DB）；migrate 失败时 exit 非 0 并打印回滚指引
  8. migrate 成功后写 `.migrate-success-dev` 标志文件
  9. `docker compose -f docker-compose.dev.yml up -d node-brain-dev`（只启动 `node-brain-dev`）
  10. 等待健康检查（端口 5220，最多 180s）

### FR-3：创建 dev-verify.sh

**文件**：`scripts/dev-verify.sh`

- 验证 `/api/brain/health`（端口 5220）→ HTTP 200，响应体含 `"status":"healthy"`
- 验证 DB 连接（`cecelia_dev`，通过 `/api/brain/tasks?limit=1` 端点间接验证）
- 退出码：0 = 全部通过，1 = 任一失败

### FR-4：创建 auto-dev-deploy.yml

**文件**：`.github/workflows/auto-dev-deploy.yml`

- 触发条件：`on: push: branches: [develop]`，paths 过滤：`packages/brain/**`、`docker-compose.dev.yml`、`scripts/dev-deploy.sh`、`scripts/dev-verify.sh`
- 并发配置：`concurrency: {group: deploy-dev-environment, cancel-in-progress: false}`（与 `auto-staging-deploy.yml` 独立并发组，避免互相排队）
- 触发路径：调用 Brain webhook `POST /api/brain/deploy {dev: true}`（webhook 架构，ubuntu-latest runner 无法直接操作宿主 Docker）
- 轮询：`GET /api/brain/deploy/dev/status` 等待完成（最多 600s）
- 失败通知：deploy job 失败时通过 Brain 告警机制通知（与 staging 失败告警渠道一致）
- workflow_dispatch 手动触发入口

### FR-5：Brain 新增 dev deploy 端点

**文件**：`packages/brain/src/routes/ops.js`

- 在 `POST /api/brain/deploy` 中新增 `dev: true` 分支处理（对称现有 `staging: true` 实现）
- 新增 `GET /api/brain/deploy/dev/status` 端点（对称 `GET /api/brain/deploy/staging/status`）
- 两个端点均需单元测试覆盖（对应文件：`packages/brain/src/__tests__/deploy-status.test.js` 补充 dev 分支测试）

### FR-6：解决 Dashboard Staging(5223) 与蓝绿 Canary(5223) 端口冲突

**文件**：`scripts/brain-deploy.sh`

- 方案 A（默认采用）：将 `TEMP_PORT=5223`（第 305 行附近）改为 `TEMP_PORT=5224`
- 若方案 A 有依赖（需确认无其他地方硬编码 5223 作为 canary 端口），全部同步修改

### FR-7：建立 Cecelia Develop 健康监控

**文件**：`scripts/dev-healthcheck-cron.sh`（新建）

- 独立 cron/healthcheck 脚本（不走 Brain tick，因 dev 环境 tick 默认 off）
- 每 5 分钟 curl `localhost:5220/api/brain/health`
- 失败时向 Brain production（5221）写入告警 task：`POST /api/brain/tasks {type:"alert", title:"develop 5220 health check failed", body:"..."}`
- 告警 task 在 Brain Dashboard 可见

### FR-8：更新 DEFINITION.md

**文件**：`DEFINITION.md`

- 新增「Cecelia Develop 环境」章节，说明：端口（5220）、DB（cecelia_dev）、触发方式（develop 分支 push 自动触发 / 手动 `bash scripts/dev-deploy.sh`）、健康检查命令
- ZenithJoy develop 缺席时可运行的测试范围说明（见 §6 可运行测试清单）

---

## 4. 不变量（Invariant）

| # | 不变量 | 验证方式 |
|---|--------|---------|
| INV-1 | production Brain（5221）在整个 Sprint 实施过程中不中断 | `curl -sf http://localhost:5221/api/brain/health` 全程返回 200 |
| INV-2 | staging Brain（5222）tick 保持 disabled，不抢 production 任务 | `staging-verify.sh` step 3：`enabled=false` |
| INV-3 | develop Brain（5220）tick 保持 disabled（`CECELIA_TICK_ENABLED=false`） | `dev-verify.sh` 中验证 tick 状态 |
| INV-4 | `dev-deploy.sh` migrate 失败时必须 exit 非 0 | 脚本异常退出测试 |
| INV-5 | `/opt/cecelia-backups/` 备份保留不超过 7 个（自动清理最旧） | `dev-deploy.sh` 内置清理逻辑 |
| INV-6 | Brain `POST /api/brain/deploy {dev:true}` 与 `staging:true` 并发时各自独立状态机，互不干扰 | `deploy-status.test.js` 并发互斥测试 |
| INV-7 | 蓝绿 canary 改用 5224 后，Dashboard staging 5223 不受 brain-deploy.sh 执行影响 | `ss -tlnp | grep ':5223'` 仅显示 dashboard staging 进程 |

**共 7 个不变量**

---

## 5. 验收断言

以下断言可在实施完成后机器执行验证：

### A1：Cecelia Staging 健康检查
```bash
curl -sf http://localhost:5222/api/brain/health
# 预期：HTTP 200，响应体含 "status":"healthy"
```

### A2：Cecelia Develop 健康检查
```bash
curl -sf http://localhost:5220/api/brain/health
# 预期：HTTP 200，响应体含 "status":"healthy"
# (FR-2 + FR-3 完成后可验)
```

### A3：Cecelia Production 基线（全程不中断）
```bash
curl -sf http://localhost:5221/api/brain/health
# 预期：HTTP 200，响应体含 "status":"healthy"
# 在 FR-6 端口冲突解决期间全程不中断
```

### A4：Staging 常驻恢复断言
```bash
docker stop cecelia-node-brain-staging
sleep 5
docker start cecelia-node-brain-staging
sleep 15
curl -sf http://localhost:5222/api/brain/health
# 预期：HTTP 200（restart: unless-stopped + depends_on pg:service_healthy 生效）
# (FR-1 完成后验)
```

### A5：cecelia_dev DB migrate 完成断言
```bash
psql -U postgres -d cecelia_dev -c "SELECT version FROM schema_version ORDER BY version DESC LIMIT 1;"
# 预期：返回最新 migration 版本号（与 packages/brain/src/migrations/ 目录最大序号一致），无报错
# (FR-2 dev-deploy.sh 执行后验)
```

### A6：端口冲突隔离断言
```bash
# 并发执行蓝绿 canary 和 staging E2E runner 期间：
ss -tlnp | grep ':5223'
# 预期方案A：grep ':5223' 仅显示 dashboard staging 进程（brain-deploy.sh 已改用 5224）
# (FR-6 完成后验)
```

### A7：Develop 监控告警断言
```bash
docker stop cecelia-node-brain-dev 2>/dev/null || true
# 等待 10 分钟后：
curl -s "localhost:5221/api/brain/tasks?type=alert&limit=5" | jq '.[].title'
# 预期：结果包含 "develop 5220 health check failed"
# (FR-7 完成后验)
```

---

## 6. Gate 前置条件

### G1：DB Migrate 门禁（针对 cecelia_dev）
- 触发：FR-2（dev-deploy.sh）首次在宿主机创建 `cecelia_dev` DB 并运行 migrations
- 门禁：
  1. 执行前确认宿主机无同名 DB：`psql -c "\l" | grep cecelia_dev`
  2. 若 DB 已存在，先 pg_dump 备份至 `/opt/cecelia-backups/`（持久路径，非 /tmp）
  3. migrate 幂等检测：`.migrate-success-dev` 标志文件存在且版本匹配则跳过
  4. migrate 失败：exit 非 0 + 打印回滚指引

### G2：CI/CD 新 Workflow 门禁
- 触发：FR-4（auto-dev-deploy.yml）+ FR-5（Brain dev deploy 端点）
- 前置：Brain `POST /api/brain/deploy {dev:true}` 端点必须先于 workflow 合并
- 门禁：
  1. Brain 端点单元测试通过
  2. 新 workflow 先在非 develop 的测试分支手动触发验证
  3. concurrency group 配置与 auto-staging-deploy 对齐（串行化）
  4. 超时设为 10min

### G3：端口冲突解决验证门禁
- 触发：FR-6（5223→5224）实施后
- 门禁：
  1. `ss -tlnp | grep 5223`：仅 dashboard staging 进程
  2. `ss -tlnp | grep 5224`：brain-deploy.sh canary 进程
  3. production 5221 全程 200：`curl -s http://localhost:5221/api/brain/health`

---

## 7. 判定点（人工审批/决策）

| # | 接缝类型 | Gate 类型 | 决策 |
|---|----------|-----------|------|
| D1 | DB migrate 不可逆（cecelia_dev 首次创建） | 自动门禁（G1） | 脚本内置，无需人工 |
| D2 | CI/CD 新 workflow + Brain 端点 | 自动门禁（G2） | 端点先合并，workflow 后合并 |
| D3 | 端口冲突 5223 方案 A（改 5224） | 自动门禁（G3）| 默认方案 A，N+7 无异议直接执行 |
| D4 | ZenithJoy develop 联动 | N/A（范围外） | ZenithJoy 侧另立 GP |

---

## 8. 实施顺序

```
FR-1（staging restart 修复，低风险，独立）
  ↓
FR-5（Brain dev deploy 端点，G2 前置必须先完成）
  ↓
FR-2 + FR-3（dev-deploy.sh + dev-verify.sh，依赖 G1 门禁通过）
  ↓
FR-4（auto-dev-deploy.yml，依赖 FR-5 已合并）
  ↓
FR-6（端口冲突修复，G3 验证）
  ↓
FR-7（develop 健康监控，可与 FR-6 并行）
  ↓
FR-8（DEFINITION.md 更新，收尾）
```

---

## 9. Cecelia Develop 单独验收范围

ZenithJoy develop 环境缺席时，以下测试可单独运行：

**可运行**：
- Cecelia Brain API 单元测试（`packages/brain/src/__tests__/`）：全量可运行
- Brain smoke test（`packages/brain/src/__tests__/smoke.test.js`）：全量可运行（仅需 Brain 5220 在线）
- Brain migrations 正确性验证（查 schema_version 版本号）：可运行
- staging-e2e-runner.js 的 brain line（Cecelia internal line）测试：可运行

**不可运行**（需 ZenithJoy develop 在线）：
- staging-e2e-runner.js 的 customer line 跨系统合同测试（curl ZJ_DEV_PORT）
- 任何依赖 ZenithJoy API 的端到端场景

ZenithJoy develop 端口建议 5202，`staging-e2e-runner.js` 预留 `ZJ_DEV_PORT` 常量占位（本 Sprint 中完成声明占位，不实施）。

---

## 10. 文件变更清单

| 文件 | 操作 | 对应 FR |
|------|------|--------|
| `docker-compose.staging.yml` | 修改 `restart: "no"` → `restart: unless-stopped`；补充 `depends_on` | FR-1 |
| `scripts/dev-deploy.sh` | 新建 | FR-2 |
| `scripts/dev-verify.sh` | 新建 | FR-3 |
| `.github/workflows/auto-dev-deploy.yml` | 新建 | FR-4 |
| `packages/brain/src/routes/ops.js` | 新增 dev 分支处理 + `GET /deploy/dev/status` | FR-5 |
| `packages/brain/src/__tests__/deploy-status.test.js` | 补充 dev 端点测试 | FR-5 |
| `scripts/brain-deploy.sh` | `TEMP_PORT=5223` → `TEMP_PORT=5224` | FR-6 |
| `scripts/dev-healthcheck-cron.sh` | 新建 | FR-7 |
| `DEFINITION.md` | 新增「Cecelia Develop 环境」章节 | FR-8 |

---

## 11. ZenithJoy Develop 声明（范围外）

本 Sprint 不实施 ZenithJoy 侧变更。ZenithJoy develop 环境常驻需在 ZenithJoy repo 单独立项，与 Cecelia 端口约定对齐（建议 5202）后再评估跨系统 E2E 接入。本 Sprint 完成后，Cecelia develop 可单独运行（仅 Brain 层联测）。

---

## NFR

- 性能：dev-deploy.sh 完整运行时间 < 120 秒（不含 npm install 冷启动）
- 可靠性：dev-healthcheck-cron.sh 探测失败时必须写 Brain alert task（不可静默丢弃）
- 幂等性：dev-deploy.sh 重复执行不产生多余进程或端口占用
- 安全：CI webhook 使用 BRAIN_DEPLOY_TOKEN 校验（已有 staging 路径同方案）

---

journey_type: deploy
target_environment: local_api
