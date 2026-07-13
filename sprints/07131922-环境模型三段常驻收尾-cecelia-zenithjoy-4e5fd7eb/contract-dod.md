# Contract DoD：Cecelia 三段常驻收尾

**Sprint**: 07131922-环境模型三段常驻收尾-cecelia-zenithjoy-4e5fd7eb
**Task ID**: d063b3e5-8fb1-4d53-b176-8e8198c7a084
**Date**: 2026-07-13

---

## Done-of-Definition（完成定义）

每个 [BEHAVIOR] 条目均须通过以下验收命令方可标记为完成。

---

## [BEHAVIOR-1]：Staging 宿主重启自动恢复

**描述**：staging Brain（5222）宿主重启后自动恢复，健康检查返回 200

**前置条件**：
- FR-1 已完成（docker-compose.staging.yml restart: unless-stopped + depends_on pg:service_healthy）
- staging Brain 正在运行

```manual:bash
# 验证 restart 策略已修改
grep 'restart:' docker-compose.staging.yml | grep -c 'unless-stopped'
# 预期：1（至少含一个 unless-stopped）

# 验证 depends_on pg:service_healthy
grep -A5 'depends_on' docker-compose.staging.yml | grep -c 'service_healthy'
# 预期：≥1

# 端到端：停止容器后自动恢复
docker stop cecelia-node-brain-staging
sleep 5
docker start cecelia-node-brain-staging
sleep 30
curl -sf http://localhost:5222/api/brain/health | jq -e '.status == "healthy"'
# 预期：输出 true，退出码 0
```

---

## [BEHAVIOR-2]：Develop Brain 部署后健康检查通过

**描述**：dev-deploy.sh 执行后 develop Brain（5220）健康检查返回 200

**前置条件**：
- FR-2（dev-deploy.sh）和 FR-3（dev-verify.sh）已完成
- Docker 可用，.env.docker 或 .env.dev 存在

```manual:bash
# 验证脚本存在
ls -la scripts/dev-deploy.sh scripts/dev-verify.sh
# 预期：两个文件均存在，均可执行

# 执行部署
bash scripts/dev-deploy.sh
# 预期：exit 0

# 验证健康
curl -sf http://localhost:5220/api/brain/health | jq -e '.status == "healthy"'
# 预期：输出 true，退出码 0

# 验证 tick 禁用（INV-3）
curl -s http://localhost:5220/api/brain/health | jq '.tick_enabled'
# 预期：false 或 null（tick 未开启）
```

---

## [BEHAVIOR-3]：Develop DB migrate 完成且版本一致

**描述**：cecelia_dev DB schema_version 与 migrations 目录最大序号一致

**前置条件**：FR-2 dev-deploy.sh 执行后

```manual:bash
# 获取 migrations 目录最大版本号
LATEST_MIGRATION=$(ls packages/brain/src/migrations/ | grep -oE '^[0-9]+' | sort -n | tail -1)
echo "Latest migration: $LATEST_MIGRATION"

# 查询 DB 中的 schema_version
DB_VERSION=$(psql -U postgres -d cecelia_dev -tAc "SELECT version FROM schema_version ORDER BY version DESC LIMIT 1;" 2>/dev/null)
echo "DB schema version: $DB_VERSION"

# 比对（两者应一致）
[ "$LATEST_MIGRATION" = "$DB_VERSION" ] && echo "PASS: versions match" || echo "FAIL: version mismatch"
# 预期：输出 PASS

# 备选：通过 API 间接验证 DB 连接（不依赖本地 psql）
curl -sf "http://localhost:5220/api/brain/tasks?limit=1"
# 预期：返回 JSON 数组（可为空 []），退出码 0
```

---

## [BEHAVIOR-4]：dev-deploy.sh 幂等性（重复执行不报错）

**描述**：dev-deploy.sh 重复执行（二次运行）不报错，幂等成功

**前置条件**：FR-2 已完成，且已完成一次成功部署

```manual:bash
# 第一次运行
bash scripts/dev-deploy.sh
echo "First run exit: $?"
# 预期：exit 0

# 第二次运行（幂等验证）
bash scripts/dev-deploy.sh
SECOND_EXIT=$?
echo "Second run exit: $SECOND_EXIT"
# 预期：exit 0

# 验证备份已创建（二次运行应生成备份）
ls /opt/cecelia-backups/cecelia_dev_backup_*.sql 2>/dev/null | wc -l
# 预期：≥1

# 验证备份不超过 7 个（INV-5）
ls /opt/cecelia-backups/ | wc -l
# 预期：≤7

# 验证迁移成功标志文件存在
ls .migrate-success-dev
# 预期：文件存在
```

---

## [BEHAVIOR-5]：Brain dev deploy 状态端点可用

**描述**：GET /api/brain/deploy/dev/status 返回 dev 部署状态 JSON（含 status 字段）

**前置条件**：FR-5 已完成（ops.js 新增 dev 端点）

```manual:bash
# 验证端点存在且返回 JSON
curl -sf http://localhost:5221/api/brain/deploy/dev/status | jq -e '.status != null'
# 预期：输出 true，退出码 0

# 验证返回格式
curl -s http://localhost:5221/api/brain/deploy/dev/status | jq '{status, timestamp}'
# 预期：JSON 对象含 status 字段

# 触发 dev deploy 并验证状态流转
curl -sf -X POST http://localhost:5221/api/brain/deploy \
  -H "Content-Type: application/json" \
  -d '{"dev": true}' | jq '.status'
# 预期："accepted"（202 状态码）

# 轮询状态
sleep 2
curl -sf http://localhost:5221/api/brain/deploy/dev/status | jq '.status'
# 预期："running" 或 "success" 或 "failed"（非 null）
```

---

## [BEHAVIOR-6]：Production 5221 全程不中断（INV-1）

**描述**：production Brain（5221）在整个 Sprint 实施过程中不中断

**验证时机**：实施前、实施中、实施后各验证一次

```manual:bash
# 实施前基线
curl -sf http://localhost:5221/api/brain/health | jq -e '.status == "healthy"'
# 预期：true

# FR-6 修改 brain-deploy.sh 前后各验证
curl -sf http://localhost:5221/api/brain/health
# 预期：HTTP 200，status=healthy

# 完整实施后验证
curl -sf http://localhost:5221/api/brain/health | jq '{status, uptime}'
# 预期：status="healthy"，uptime 持续累积（未重启）
```

---

## [BEHAVIOR-7]：蓝绿 canary 端口改为 5224，5223 仅归 dashboard staging

**描述**：brain-deploy.sh 蓝绿 canary 改用 5224 后，5223 端口仅被 dashboard staging 占用

**前置条件**：FR-6 已完成（brain-deploy.sh TEMP_PORT 5223→5224）

```manual:bash
# 验证代码修改
grep 'TEMP_PORT' scripts/brain-deploy.sh | grep -c '5224'
# 预期：≥1

# 验证无残留 5223 canary 引用
grep 'TEMP_PORT.*5223\|5223.*TEMP_PORT' scripts/brain-deploy.sh
# 预期：无输出（grep 返回非 0 退出码）

# 运行时验证（如有 dashboard staging 运行）
ss -tlnp | grep ':5223'
# 预期：显示 dashboard staging 进程（而非 brain-deploy canary）
# 或：无输出（dashboard staging 未运行时）

# 确认无其他文件硬编码 5223 为 canary
grep -rn 'TEMP_PORT.*5223\|5223.*canary' packages/ scripts/ .github/ --include="*.sh" --include="*.yml" --include="*.js"
# 预期：无输出
```

---

## [BEHAVIOR-8]：Develop 健康监控告警写入 Brain production

**描述**：develop Brain 停止后，5 分钟内 Brain production（5221）出现 type=alert 的健康告警

**前置条件**：FR-7 已完成（dev-healthcheck-cron.sh），且 cron 已启动

**注意**：本验证耗时约 10 分钟，建议在其他验收完成后执行

```manual:bash
# 验证脚本存在
ls -la scripts/dev-healthcheck-cron.sh
# 预期：文件存在，可执行

# 验证脚本内容包含 Brain alert 写入
grep -c 'localhost:5221/api/brain/tasks' scripts/dev-healthcheck-cron.sh
# 预期：≥1

# 端到端告警验证（停止 develop Brain）
docker stop cecelia-node-brain-dev 2>/dev/null || true

# 等待 cron 周期（5 分钟 + 缓冲）
echo "等待健康检查告警写入 Brain...（约 6 分钟）"
sleep 360

# 查询告警
curl -s "http://localhost:5221/api/brain/tasks?type=alert&limit=10" | jq '[.[] | select(.title | contains("5220") or contains("develop"))] | length'
# 预期：≥1（存在含 5220 或 develop 关键词的告警）

# 恢复 develop Brain
bash scripts/dev-deploy.sh
```

---

## 不变量汇总验证

```manual:bash
# INV-1：production 不中断
curl -sf http://localhost:5221/api/brain/health | jq -e '.status == "healthy"'

# INV-2：staging tick disabled
curl -s http://localhost:5222/api/brain/health | jq '.tick_enabled == false'

# INV-3：develop tick disabled
curl -s http://localhost:5220/api/brain/health | jq '.tick_enabled == false'

# INV-4：migrate 失败时 exit 非 0（单元测试覆盖，见 tests/unit/dev-deploy.test.js）

# INV-5：备份不超过 7 个
ls /opt/cecelia-backups/ 2>/dev/null | wc -l

# INV-6：并发测试（见 tests/unit/deploy-status.test.js）

# INV-7：5223 仅为 dashboard staging
grep 'TEMP_PORT' scripts/brain-deploy.sh | grep '5224'
```
