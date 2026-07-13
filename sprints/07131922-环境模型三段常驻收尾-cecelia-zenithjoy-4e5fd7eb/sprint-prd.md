# Sprint PRD：Cecelia 三段常驻收尾（ZenithJoy develop 待独立 GP）

task_id: d063b3e5-8fb1-4d53-b176-8e8198c7a084
sprint_dir: sprints/07131922-环境模型三段常驻收尾-cecelia-zenithjoy-4e5fd7eb
created_at: 2026-07-13

---

## Invariant 约束

> 来源：Brain decisions API（active）+ proposal_doc + 已有代码模式

1. **三段常驻格局不可回退**（决策 1c6232b7）
   Cecelia 固定 develop(5220/cecelia_dev) + staging(5222/cecelia_staging) + production(5221/cecelia) 三段常驻。禁止废弃 staging、禁止将 preview 顶替 staging 职责（决策 48331b37 已被 1c6232b7 废弃）。

2. **Production 5221 全程不中断**（来自 proposal_doc Gate G3 + 代码模式）
   任何端口冲突修复操作（Step 4）期间，`curl -sf http://localhost:5221/api/brain/health` 必须全程返回 HTTP 200，不允许生产中断。

3. **staging tick 永远硬关**（来自 `docker-compose.staging.yml` 代码模式）
   staging 容器必须保留 `CECELIA_TICK_HARD_OFF=1` + `CECELIA_TICK_ENABLED=false`，禁止 staging tick 与 production 竞争任务派发。

4. **Migrate 不可逆——必须先备份**（决策 3ac02755 + proposal_doc G1）
   cecelia_dev 首次创建或二次运行前，若 DB 已存在，必须先 `pg_dump` 到 `/opt/cecelia-backups/`（持久路径，非 /tmp），保留最近 7 份，migrate 失败须 exit 非 0 并打印回滚指引。

5. **CI 新 Workflow 必须 Brain 端点前置**（proposal_doc Gate G2）
   `auto-dev-deploy.yml` 依赖 `POST /api/brain/deploy {dev:true}` 和 `GET /api/brain/deploy/dev/status` 端点，Brain 端点必须先合并，workflow 才能合并；新 workflow 先在测试分支手动验证通过后再合并到 develop/main。

6. **ZenithJoy develop 不在本 Sprint 范围**（proposal_doc 范围声明）
   本 Sprint 仅改动 Cecelia monorepo；ZenithJoy develop 常驻须另立独立 GP。ZenithJoy 侧任何文件不得在本 Sprint 修改。

7. **端口冲突方案需人工决策**（proposal_doc 判定点 #4）
   Dashboard staging(5223) vs 蓝绿 canary(5223) 端口冲突解决，需在实施 Step 4 前选定方案 A（canary 改 5224）或方案 B（互斥锁）。N+7 天无决策默认方案 A。

---

## 累积 FR

### FR-01：修复 Cecelia Staging 常驻策略（restart）

- 将 `docker-compose.staging.yml` 中 `restart: "no"` 改为 `restart: unless-stopped`
- 补充 `depends_on: {pg: {condition: service_healthy}}` + `healthcheck start_period: 30s`（若已有则确认参数合理）
- 验证断言：`docker stop cecelia-node-brain-staging && sleep 5 && docker start cecelia-node-brain-staging && sleep 15 && curl -sf http://localhost:5222/api/brain/health` → HTTP 200

### FR-02：创建 Cecelia Develop 部署脚本

- 新增 `scripts/dev-deploy.sh`，步骤对称 `staging-deploy.sh`：DB 创建(`cecelia_dev`) → migrate 幂等检测(`.migrate-success` + schema_version 版本匹配则跳过) → `docker compose -f docker-compose.dev.yml up -d node-brain-dev` → healthcheck 5220
- 二次运行前先 `pg_dump cecelia_dev > /opt/cecelia-backups/cecelia_dev_backup_$(date +%Y%m%d%H%M%S).sql`
- migrate 失败：exit 非 0，打印回滚指引 `psql cecelia_dev < /opt/cecelia-backups/backup.sql`
- 新增 `scripts/dev-verify.sh`：验证 `/api/brain/health`(5220) + DB 连接(`cecelia_dev`)
- 验证断言：`bash scripts/dev-deploy.sh && curl -sf http://localhost:5220/api/brain/health` → HTTP 200；`psql -U postgres -d cecelia_dev -c "SELECT version FROM schema_version ORDER BY version DESC LIMIT 1;"` → 返回最新 migration 版本号

### FR-03：建立 Cecelia Develop CI 自动触发

- Brain 新增端点 `POST /api/brain/deploy {dev:true}` 和 `GET /api/brain/deploy/dev/status`（参照 ops.js 现有实现，有单元测试）
- 新增 `.github/workflows/auto-dev-deploy.yml`，触发条件 `on: push: branches: [develop]`，paths 过滤对齐 `auto-staging-deploy.yml`
- Workflow 调用 Brain webhook 触发部署，轮询 `/api/brain/deploy/dev/status` 等待完成（timeout 10 min）
- `concurrency: {group: deploy-environment, cancel-in-progress: false}`，与 `auto-staging-deploy.yml` 同组串行化，不竞争宿主 Docker daemon
- 失败时通过 Brain 告警 task 通知，开发者可在 PR 时间线感知
- DEFINITION.md 补充「develop 环境部署说明」章节

### FR-04：解决 Dashboard Staging(5223) 与蓝绿 Canary(5223) 端口冲突

- 待人工选定方案后实施（判定点 #4，N+7 默认方案 A）：
  - 方案 A：`scripts/brain-deploy.sh` 中 `TEMP_PORT=5223` 改为 `TEMP_PORT=5224`
  - 方案 B：`brain-deploy.sh` 入口加文件互斥锁防并发
- 验证断言：并发执行蓝绿 canary 和 staging E2E 期间 `ss -tlnp | grep ':5223'` 同一时刻只有一个进程

### FR-05：建立 Cecelia Develop 健康监控

- `docker-compose.dev.yml` 的 `node-brain-dev` 补充/确认 healthcheck（端口 5220，interval/retries 合理）
- 新增独立 cron/healthcheck 脚本（不走 Brain tick，因 dev tick 为 off），每 5 分钟 curl `localhost:5220/api/brain/health`，失败时 `POST /api/brain/tasks {type:"alert", title:"develop 5220 health check failed"}`
- 验证断言：`docker stop cecelia-node-brain-dev && sleep 10m && curl -s "localhost:5221/api/brain/tasks?type=alert&limit=5" | jq '.[].title'` → 包含 `"develop 5220 health check failed"`

### FR-06：ZenithJoy Develop 联动声明

- 不实施 ZenithJoy 侧变更
- 在 Cecelia Brain 的 `staging-e2e-runner.js` 预留 `ZJ_DEV_PORT` 常量占位（供后续 ZenithJoy develop GP 接入）
- 文档化 Cecelia develop 单独验收范围：Brain 单元测试、smoke test、migrations 验证、brain line E2E 全量可运行；customer line 跨系统合同测试不可运行（需 ZenithJoy develop GP 完成后接入）

---

## NFR

- **可用性**：staging 宿主重启后自动恢复（unless-stopped + depends_on pg:healthy），无需手动干预
- **安全性**：DB migrate 前备份落持久路径 `/opt/cecelia-backups/`，保留 7 份；migrate 失败 exit 非 0
- **CI 时长**：`auto-dev-deploy.yml` 并发 group 串行化，timeout 10 min，不拖垮现有 staging CI
- **监控**：develop 5220 down 后 10 分钟内 Brain Dashboard 可见告警 task

---

## 验收断言汇总

1. `curl -sf http://localhost:5222/api/brain/health` → HTTP 200（`"status":"healthy"`）
2. `curl -sf http://localhost:5220/api/brain/health` → HTTP 200（`"status":"healthy"`）
3. `curl -sf http://localhost:5221/api/brain/health` → HTTP 200（全程不中断）
4. `docker stop cecelia-node-brain-staging && sleep 5 && docker start cecelia-node-brain-staging && sleep 15 && curl -sf http://localhost:5222/api/brain/health` → HTTP 200
5. `psql -U postgres -d cecelia_dev -c "SELECT version FROM schema_version ORDER BY version DESC LIMIT 1;"` → 最新 migration 版本号
6. 并发 canary + staging runner 期间 `ss -tlnp | grep ':5223'` 同一时刻仅一个进程
7. `docker stop cecelia-node-brain-dev && sleep 10m && curl -s "localhost:5221/api/brain/tasks?type=alert&limit=5" | jq '.[].title'` → 含 `"develop 5220 health check failed"`

---

journey_type: harness_initiative
target_environment: local_api
