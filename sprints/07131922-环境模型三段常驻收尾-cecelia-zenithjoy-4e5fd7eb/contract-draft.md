# 合同草案：Cecelia 三段常驻收尾

task_id: d063b3e5-8fb1-4d53-b176-8e8198c7a084
sprint_dir: sprints/07131922-环境模型三段常驻收尾-cecelia-zenithjoy-4e5fd7eb
base_repo: cecelia
created_at: 2026-07-13

---

## 范围声明

本合同覆盖 Cecelia monorepo 的三段常驻环境（develop/staging/production）收尾工作。
ZenithJoy 侧任何文件不在本 Sprint 修改范围内。

**三段常驻格局**：
- develop：端口 5220，DB `cecelia_dev`
- staging：端口 5222，DB `cecelia_staging`
- production：端口 5221，DB `cecelia`

---

## 不变量（Invariants）

基于决策 API 和 PRD，以下约束贯穿整个 Sprint，任何改动不得违反：

| # | 不变量 | 来源 |
|---|--------|------|
| INV-1 | 三段常驻格局不可回退（develop/staging/production 固定共存） | 决策 1c6232b7 |
| INV-2 | Production 5221 全程不中断，任何操作期间 health 端点必须返回 HTTP 200 | 决策 + G3 Gate |
| INV-3 | staging tick 永远硬关（CECELIA_TICK_HARD_OFF=1 + CECELIA_TICK_ENABLED=false） | docker-compose.staging.yml |
| INV-4 | migrate 前必须先 pg_dump 到 /opt/cecelia-backups/（非 /tmp），保留最近 7 份 | 决策 3ac02755 |
| INV-5 | CI auto-dev-deploy.yml 依赖 Brain 端点先合并，workflow 才可合并 | G2 Gate |
| INV-6 | ZenithJoy 侧文件不在本 Sprint 修改 | PRD 范围声明 |
| INV-7 | 端口冲突方案（5223 冲突）需人工决策，N+7 天无决策默认方案 A（canary 改 5224） | 判定点 #4 |

---

## 功能需求合同

### FR-01：修复 Cecelia Staging 常驻策略

**输入条件**：
- `docker-compose.staging.yml` 存在，容器 `cecelia-node-brain-staging` 可运行

**执行行为**：
- `docker-compose.staging.yml` 中 `node-brain-staging` 的 `restart` 字段从 `"no"` 变为 `unless-stopped`
- 补充 `depends_on: {pg: {condition: service_healthy}}` 或确认已存在合理的健康依赖
- healthcheck `start_period` 设置为 ≥ 30s

**可观测输出**：
- 执行 `docker stop cecelia-node-brain-staging && sleep 5 && docker start cecelia-node-brain-staging && sleep 15`
- 之后 `curl -sf http://localhost:5222/api/brain/health` 返回 HTTP 200，body 含 `"status":"healthy"`

**不违反**：INV-2（production 5221 全程不中断）、INV-3（staging tick 保持硬关）

---

### FR-02：创建 Cecelia Develop 部署脚本

**输入条件**：
- `/opt/cecelia-backups/` 目录存在（或可创建）
- PostgreSQL 可连接，用户有权创建 DB

**执行行为**：
- 新增 `scripts/dev-deploy.sh`，步骤：
  1. 若 `cecelia_dev` DB 已存在 → pg_dump 到 `/opt/cecelia-backups/cecelia_dev_backup_$(date +%Y%m%d%H%M%S).sql`
  2. 保留最近 7 份备份，清理更旧的
  3. 创建 `cecelia_dev` DB（若不存在）
  4. 幂等 migrate 检测（`.migrate-success` + schema_version 版本匹配则跳过）
  5. migrate 失败 → exit 非 0，打印回滚指引
  6. `docker compose -f docker-compose.dev.yml up -d node-brain-dev`
  7. healthcheck 等待 5220 端口
- 新增 `scripts/dev-verify.sh`：验证 5220 health 端点 + cecelia_dev DB 连接

**可观测输出**：
- `bash scripts/dev-deploy.sh` 退出码 0
- `curl -sf http://localhost:5220/api/brain/health` → HTTP 200
- `psql -U postgres -d cecelia_dev -c "SELECT version FROM schema_version ORDER BY version DESC LIMIT 1;"` → 返回最新 migration 版本号
- `/opt/cecelia-backups/` 内有 `.sql` 备份文件（二次运行时）

**不违反**：INV-4（migrate 前必须备份）

---

### FR-03：建立 Cecelia Develop CI 自动触发

**输入条件**：
- Brain 已有 ops.js 现有 deploy 实现模式
- develop 分支存在

**执行行为**：
- Brain 新增端点 `POST /api/brain/deploy {dev:true}` → 触发 dev-deploy.sh
- Brain 新增端点 `GET /api/brain/deploy/dev/status` → 返回最近 dev 部署状态
- 两个端点有对应单元测试
- 新增 `.github/workflows/auto-dev-deploy.yml`，触发条件 `on: push: branches: [develop]`
- paths 过滤同 `auto-staging-deploy.yml`
- concurrency group `deploy-environment`，`cancel-in-progress: false`，与 staging 串行
- 失败时创建 Brain alert task 通知

**可观测输出**：
- 向 develop 分支推送代码后，GitHub Actions 自动触发 `auto-dev-deploy.yml`
- Workflow 调用 `POST /api/brain/deploy {dev:true}` 成功（HTTP 2xx）
- Workflow 轮询 `/api/brain/deploy/dev/status` 直到 `success` 或超时（10min）

**不违反**：INV-5（Brain 端点先合并，workflow 才可合并）

---

### FR-04：解决 Dashboard Staging(5223) 与蓝绿 Canary(5223) 端口冲突

**输入条件**：
- 人工决策已选定（或 N+7 天到期默认方案 A）
- `scripts/brain-deploy.sh` 存在

**执行行为（方案 A，默认）**：
- `brain-deploy.sh` 中 `TEMP_PORT=5223` 改为 `TEMP_PORT=5224`

**执行行为（方案 B）**：
- `brain-deploy.sh` 入口加文件互斥锁

**可观测输出**：
- 并发执行蓝绿 canary 和 staging E2E 期间 `ss -tlnp | grep ':5223'` 同一时刻仅有一个进程监听

**不违反**：INV-7（需人工决策，N+7 默认方案 A）

---

### FR-05：建立 Cecelia Develop 健康监控

**输入条件**：
- `docker-compose.dev.yml` 存在，`node-brain-dev` 服务已配置
- Brain 5221 可接受 task 创建请求

**执行行为**：
- `docker-compose.dev.yml` 的 `node-brain-dev` 补充/确认 healthcheck（端口 5220，interval ≤ 60s，retries ≥ 3）
- 新增独立 healthcheck 脚本（不走 Brain tick），每 5 分钟 curl `localhost:5220/api/brain/health`
- 失败时 `POST localhost:5221/api/brain/tasks` 创建 `{type:"alert", title:"develop 5220 health check failed"}`

**可观测输出**：
- 停止 `cecelia-node-brain-dev` 后，等待 ≤ 10 分钟
- `curl -s "localhost:5221/api/brain/tasks?type=alert&limit=5" | jq '.[].title'` 输出含 `"develop 5220 health check failed"`

**不违反**：INV-1（不影响三段格局）

---

### FR-06：ZenithJoy Develop 联动声明

**输入条件**：
- `packages/brain/src/staging-e2e-runner.js` 存在

**执行行为**：
- 在 `staging-e2e-runner.js` 中预留 `ZJ_DEV_PORT` 常量占位（注释说明供后续接入）
- DEFINITION.md 补充「develop 环境部署说明」章节
- 文档化 Cecelia develop 单独验收范围

**可观测输出**：
- `grep -n "ZJ_DEV_PORT" packages/brain/src/staging-e2e-runner.js` → 有匹配行
- DEFINITION.md 含 `develop 环境` 相关章节

**不违反**：INV-6（ZenithJoy 侧文件不修改）

---

## E2E 验收

### 验收环境

- 宿主机：本机（local_api 模式）
- 验收前提：PostgreSQL 可连接，Docker daemon 运行正常，production 5221 已在运行
- 验收顺序：从上到下，逐条执行，任一失败需记录原因

### 验收步骤

**Step 1：Production 不中断基线核验**
```bash
# 验收前先确认 production 健康
curl -sf http://localhost:5221/api/brain/health
# 预期：HTTP 200，body 含 "status":"healthy"
```

**Step 2：Staging 常驻恢复（FR-01）**
```bash
# 验证 staging 配置已更新
grep "restart:" /workspace/docker-compose.staging.yml
# 预期：输出 "restart: unless-stopped"（无引号 "no"）

grep "CECELIA_TICK_HARD_OFF\|CECELIA_TICK_ENABLED" /workspace/docker-compose.staging.yml
# 预期：含 CECELIA_TICK_HARD_OFF=1 和 CECELIA_TICK_ENABLED=false

# 验证重启后自动恢复
docker stop cecelia-node-brain-staging && sleep 5 && docker start cecelia-node-brain-staging && sleep 15
curl -sf http://localhost:5222/api/brain/health
# 预期：HTTP 200，body 含 "status":"healthy"
```

**Step 3：Production 仍不中断（贯穿操作后核验）**
```bash
curl -sf http://localhost:5221/api/brain/health
# 预期：HTTP 200（staging 操作不影响 production）
```

**Step 4：Develop 部署脚本（FR-02）**
```bash
# 首次或二次运行 dev-deploy
bash /workspace/scripts/dev-deploy.sh

# 验证 health
curl -sf http://localhost:5220/api/brain/health
# 预期：HTTP 200，body 含 "status":"healthy"

# 验证 DB migrate 版本
psql -U postgres -d cecelia_dev -c "SELECT version FROM schema_version ORDER BY version DESC LIMIT 1;"
# 预期：返回最新 migration 版本号（非空行）

# 验证备份已创建（二次运行后）
ls /opt/cecelia-backups/cecelia_dev_backup_*.sql 2>/dev/null | wc -l
# 预期：≥ 1
```

**Step 5：Brain Deploy 端点（FR-03）**
```bash
# 验证端点存在
curl -sf -X POST http://localhost:5221/api/brain/deploy \
  -H "Content-Type: application/json" \
  -d '{"dev":true}'
# 预期：HTTP 2xx，body 含部署触发确认

curl -sf http://localhost:5221/api/brain/deploy/dev/status
# 预期：HTTP 200，body 含 status 字段
```

**Step 6：端口冲突验证（FR-04，方案 A）**
```bash
# 验证 brain-deploy.sh 已使用 5224
grep "TEMP_PORT" /workspace/scripts/brain-deploy.sh
# 预期：含 TEMP_PORT=5224（不含 5223）
```

**Step 7：Develop 健康监控（FR-05）**
```bash
# 验证 healthcheck 脚本存在且可执行
ls -la /workspace/scripts/dev-healthcheck.sh 2>/dev/null || \
  ls -la /workspace/scripts/dev-monitor.sh 2>/dev/null
# 预期：文件存在

# 验证 docker-compose.dev.yml 包含 node-brain-dev healthcheck
grep -A5 "healthcheck" /workspace/docker-compose.dev.yml | grep -E "5220|interval"
# 预期：含端口 5220 的 healthcheck 配置

# 功能验证（需停止 dev 后等待）
# 注意：此步骤耗时 ≤10 分钟，可选执行
# docker stop cecelia-node-brain-dev
# sleep 600
# curl -s "localhost:5221/api/brain/tasks?type=alert&limit=5" | jq '.[].title'
# 预期：含 "develop 5220 health check failed"
```

**Step 8：ZenithJoy 联动占位（FR-06）**
```bash
# 验证 ZJ_DEV_PORT 占位
grep -n "ZJ_DEV_PORT" /workspace/packages/brain/src/staging-e2e-runner.js
# 预期：有匹配行（常量占位）

# 验证 DEFINITION.md 已更新
grep -n "develop" /workspace/DEFINITION.md | head -5
# 预期：含 develop 环境相关说明
```

**Step 9：Production 最终不中断核验**
```bash
curl -sf http://localhost:5221/api/brain/health
# 预期：HTTP 200（全程从未中断）
```

### 验收判定

| 步骤 | 通过条件 | 严重级别 |
|------|----------|----------|
| Step 1 | HTTP 200 | P0（前置条件） |
| Step 2 | restart=unless-stopped + tick 硬关 + 重启恢复 | P0 |
| Step 3 | HTTP 200 | P0（INV-2） |
| Step 4 | health 200 + DB 版本返回 | P0 |
| Step 5 | 两端点 HTTP 2xx | P1 |
| Step 6 | TEMP_PORT=5224 | P1（等人工决策） |
| Step 7 | healthcheck 存在 | P1 |
| Step 8 | ZJ_DEV_PORT 占位 | P2 |
| Step 9 | HTTP 200 | P0（INV-2 终验） |

---

## NFR 合同

| NFR | 可测量断言 |
|-----|-----------|
| 可用性 | staging 宿主重启后 30s 内自动恢复（unless-stopped + pg:healthy） |
| 安全性 | migrate 前备份落 /opt/cecelia-backups/（ls 可见），保留 7 份 |
| CI 时长 | auto-dev-deploy.yml timeout ≤ 10 min，concurrency 串行不竞争 |
| 监控 | develop 5220 down 后 10 分钟内 Brain tasks 可见 alert |

---

## 验收完成标准

1. 所有 P0 步骤全部通过
2. P1 步骤通过率 ≥ 75%
3. production 5221 健康检查在 Step 1/3/9 均返回 HTTP 200
4. staging tick 配置核验：`CECELIA_TICK_HARD_OFF=1` 和 `CECELIA_TICK_ENABLED=false` 同时存在

---

journey_type: harness_initiative
target_environment: local_api
