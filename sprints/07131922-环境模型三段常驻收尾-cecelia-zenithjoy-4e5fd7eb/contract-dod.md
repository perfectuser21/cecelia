# DoD（Definition of Done）：Cecelia 三段常驻收尾

task_id: d063b3e5-8fb1-4d53-b176-8e8198c7a084
sprint_dir: sprints/07131922-环境模型三段常驻收尾-cecelia-zenithjoy-4e5fd7eb
base_repo: cecelia
created_at: 2026-07-13

---

## [BEHAVIOR] 条目

### [BEHAVIOR][BEHAVIOR-01] Staging 容器宿主重启后自动恢复（FR-01 / INV-3）

**触发**：宿主机重启或 `docker stop cecelia-node-brain-staging` 后等待 15 秒

**预期行为**：
- `docker-compose.staging.yml` 中 `node-brain-staging.restart` 值为 `unless-stopped`
- staging 容器在 15 秒内自动重启并通过 healthcheck
- staging tick 配置保持 `CECELIA_TICK_HARD_OFF=1` 且 `CECELIA_TICK_ENABLED=false`

**验收命令**：
```bash
manual:bash grep "restart:" /workspace/docker-compose.staging.yml | grep -v "no" | grep "unless-stopped"
manual:bash grep "CECELIA_TICK_HARD_OFF=1" /workspace/docker-compose.staging.yml
manual:bash grep "CECELIA_TICK_ENABLED=false" /workspace/docker-compose.staging.yml
```

---

### [BEHAVIOR][BEHAVIOR-02] Production 5221 全程不中断（INV-2）

**触发**：任何 FR-01 至 FR-06 的实施操作期间

**预期行为**：
- `curl -sf http://localhost:5221/api/brain/health` 始终返回 HTTP 200
- response body 含 `"status":"healthy"`
- 不允许出现 connection refused、HTTP 5xx、timeout

**验收命令**：
```bash
manual:bash curl -sf http://localhost:5221/api/brain/health | jq -e '.status == "healthy"'
```

---

### [BEHAVIOR][BEHAVIOR-03] Develop 部署脚本：备份优先、migrate 幂等（FR-02 / INV-4）

**触发**：二次运行 `bash scripts/dev-deploy.sh` 时

**预期行为**：
- 若 `cecelia_dev` DB 已存在，先 pg_dump 到 `/opt/cecelia-backups/` 目录
- 备份文件名格式：`cecelia_dev_backup_YYYYMMDDHHMMSS.sql`
- 保留最近 7 份，超出删除旧文件
- migrate 已完成时（`.migrate-success` + schema_version 匹配）跳过 migrate
- migrate 失败时 exit 非 0，打印包含 `psql cecelia_dev <` 的回滚指引

**验收命令**：
```bash
manual:bash test -f /workspace/scripts/dev-deploy.sh && echo "dev-deploy.sh exists"
manual:bash grep -n "pg_dump" /workspace/scripts/dev-deploy.sh
manual:bash grep -n "/opt/cecelia-backups" /workspace/scripts/dev-deploy.sh
manual:bash grep -n "migrate-success\|schema_version" /workspace/scripts/dev-deploy.sh
manual:bash grep -n "exit.*[^0]\|exit 1\|exit 2" /workspace/scripts/dev-deploy.sh
```

---

### [BEHAVIOR][BEHAVIOR-04] Develop 健康状态可观测：5220 宕机后 10 分钟内产生 alert（FR-05）

**触发**：`docker stop cecelia-node-brain-dev` 后等待 ≤ 10 分钟

**预期行为**：
- 独立 healthcheck 脚本（非 Brain tick）每 5 分钟轮询 `localhost:5220/api/brain/health`
- 轮询失败时向 Brain 5221 `POST /api/brain/tasks` 创建 alert 任务
- alert 任务 title 含 `develop 5220 health check failed`
- 10 分钟内 `curl -s "localhost:5221/api/brain/tasks?type=alert&limit=5"` 可见该告警

**验收命令**：
```bash
manual:bash test -f /workspace/scripts/dev-healthcheck.sh && echo "healthcheck script exists" || test -f /workspace/scripts/dev-monitor.sh && echo "monitor script exists"
manual:bash grep -n "5220" /workspace/docker-compose.dev.yml | grep -i "healthcheck\|test"
```

---

### [BEHAVIOR][BEHAVIOR-05] Brain Deploy 端点：触发 dev 部署并可查询状态（FR-03 / INV-5）

**触发**：调用 `POST /api/brain/deploy {dev:true}`

**预期行为**：
- Brain 返回 HTTP 2xx，body 含部署触发确认（job_id 或 accepted 字段）
- `GET /api/brain/deploy/dev/status` 返回 HTTP 200，body 含 `status` 字段
- 状态值包含 `pending`/`running`/`success`/`failed` 之一
- 两个端点有对应单元测试文件

**验收命令**：
```bash
manual:bash grep -rn "deploy.*dev\|dev.*deploy" /workspace/packages/brain/src/ | grep -v "__tests__\|.test." | grep -v "node_modules" | head -10
manual:bash find /workspace/packages/brain/src/__tests__ -name "*.test.*" | xargs grep -l "deploy.*dev\|dev.*deploy" 2>/dev/null
```

---

### [BEHAVIOR][BEHAVIOR-06] Staging Tick 永远硬关（INV-3，回归防护）

**触发**：任何对 `docker-compose.staging.yml` 的修改后

**预期行为**：
- `CECELIA_TICK_HARD_OFF=1` 存在于 environment 块
- `CECELIA_TICK_ENABLED=false` 存在于 environment 块
- 两者同时存在，不允许只有其一

**验收命令**：
```bash
manual:bash grep -c "CECELIA_TICK_HARD_OFF=1\|CECELIA_TICK_ENABLED=false" /workspace/docker-compose.staging.yml | grep -E "^2$"
```

---

### [BEHAVIOR][BEHAVIOR-07] ZenithJoy 侧不修改 + 联动占位存在（FR-06 / INV-6）

**触发**：Sprint 完成后

**预期行为**：
- `staging-e2e-runner.js` 含 `ZJ_DEV_PORT` 常量占位
- 本 Sprint 不修改任何 ZenithJoy 仓库文件
- DEFINITION.md 含 develop 环境相关章节

**验收命令**：
```bash
manual:bash grep -n "ZJ_DEV_PORT" /workspace/packages/brain/src/staging-e2e-runner.js
manual:bash grep -in "develop.*环境\|develop environment" /workspace/DEFINITION.md | head -3
```

---

## 不变量断言（INV 对应 DoD）

| Invariant | 对应 BEHAVIOR | 验收命令 |
|-----------|---------------|----------|
| INV-1 三段常驻格局不回退 | BEHAVIOR-01, BEHAVIOR-02 | 见 BEHAVIOR-01/02 |
| INV-2 Production 全程不中断 | BEHAVIOR-02 | `curl -sf localhost:5221/api/brain/health` |
| INV-3 staging tick 永远硬关 | BEHAVIOR-01, BEHAVIOR-06 | `grep CECELIA_TICK_HARD_OFF=1 docker-compose.staging.yml` |
| INV-4 migrate 前必须备份 | BEHAVIOR-03 | `grep pg_dump scripts/dev-deploy.sh` |
| INV-5 Brain 端点先合并 | BEHAVIOR-05 | 单元测试文件存在 |
| INV-6 ZenithJoy 不改 | BEHAVIOR-07 | ZJ_DEV_PORT 占位存在 |
| INV-7 端口冲突需人工决策 | BEHAVIOR-08（可选，等人工决策） | `grep TEMP_PORT scripts/brain-deploy.sh` |

---

## 完成判定

以下全部满足才视为 DoD DONE：

- [ ] BEHAVIOR-01：staging restart=unless-stopped + tick 硬关双保险
- [ ] BEHAVIOR-02：production 5221 health 全程 HTTP 200
- [ ] BEHAVIOR-03：dev-deploy.sh 存在，含 pg_dump + /opt/cecelia-backups
- [ ] BEHAVIOR-04：healthcheck 脚本存在，docker-compose.dev.yml 含 5220 healthcheck
- [ ] BEHAVIOR-05：Brain deploy/dev 端点存在，有单元测试
- [ ] BEHAVIOR-06：staging tick 两个环境变量同时存在（grep count = 2）
- [ ] BEHAVIOR-07：ZJ_DEV_PORT 占位存在，DEFINITION.md 含 develop 章节

---

## 测试文件索引

- `sprints/07131922-环境模型三段常驻收尾-cecelia-zenithjoy-4e5fd7eb/tests/fr01-staging-restart.test.sh`
- `sprints/07131922-环境模型三段常驻收尾-cecelia-zenithjoy-4e5fd7eb/tests/fr02-dev-deploy.test.sh`
- `sprints/07131922-环境模型三段常驻收尾-cecelia-zenithjoy-4e5fd7eb/tests/fr03-brain-deploy-endpoint.test.js`
- `sprints/07131922-环境模型三段常驻收尾-cecelia-zenithjoy-4e5fd7eb/tests/fr05-dev-healthcheck.test.sh`
- `sprints/07131922-环境模型三段常驻收尾-cecelia-zenithjoy-4e5fd7eb/tests/invariants.test.sh`
