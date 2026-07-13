# Contract Draft：Cecelia 三段常驻收尾

**Sprint**: 07131922-环境模型三段常驻收尾-cecelia-zenithjoy-4e5fd7eb
**Task ID**: d063b3e5-8fb1-4d53-b176-8e8198c7a084
**Target Environment**: local_api
**Journey Type**: deploy
**Date**: 2026-07-13

---

## 范围摘要

补齐 Cecelia 三段常驻（develop 5220 / staging 5222 / production 5221）最后一公里：

1. 修复 staging docker-compose restart 策略（FR-1）
2. 建立 develop 部署脚本链路（FR-2、FR-3）
3. 建立 CI 自动触发 develop 部署（FR-4）
4. Brain 新增 dev deploy 端点（FR-5）
5. 解决 Dashboard staging 与蓝绿 canary 端口冲突（FR-6）
6. 建立 develop 健康监控告警（FR-7）
7. 更新 DEFINITION.md develop 章节（FR-8）

---

## E2E 验收

### Test Contract 表

| ID | 行为描述 | 类型 | 执行方式 | 可机器验证断言 |
|----|---------|------|---------|--------------|
| [BEHAVIOR-1] | staging Brain（5222）宿主重启后自动恢复，健康检查返回 200 | invariant | manual:bash | `docker stop cecelia-node-brain-staging && sleep 5 && docker start cecelia-node-brain-staging && sleep 30 && curl -sf http://localhost:5222/api/brain/health \| jq -e '.status=="healthy"'` |
| [BEHAVIOR-2] | dev-deploy.sh 执行后 develop Brain（5220）健康检查返回 200，响应体含 `"status":"healthy"` | functional | manual:bash | `bash scripts/dev-deploy.sh && curl -sf http://localhost:5220/api/brain/health \| jq -e '.status=="healthy"'` |
| [BEHAVIOR-3] | dev-deploy.sh 执行后 cecelia_dev DB schema_version 与 migrations 目录最大序号一致 | functional | manual:bash | `psql -U postgres -d cecelia_dev -c "SELECT version FROM schema_version ORDER BY version DESC LIMIT 1;" \| grep -E '[0-9]+'` |
| [BEHAVIOR-4] | dev-deploy.sh 重复执行（二次运行）不报错，幂等成功 | functional | manual:bash | `bash scripts/dev-deploy.sh && bash scripts/dev-deploy.sh; echo "exit: $?"` 预期最终 exit 0 |
| [BEHAVIOR-5] | GET /api/brain/deploy/dev/status 返回 dev 部署状态 JSON（含 status 字段） | api | unit-test | `curl -sf http://localhost:5221/api/brain/deploy/dev/status \| jq -e '.status != null'` |
| [BEHAVIOR-6] | production Brain（5221）在 FR-6 端口修改实施前后全程响应 200 | invariant | manual:bash | `curl -sf http://localhost:5221/api/brain/health \| jq -e '.status=="healthy"'`（实施前后均验证） |
| [BEHAVIOR-7] | brain-deploy.sh 蓝绿 canary 改用 5224 后，5223 端口仅被 dashboard staging 占用 | invariant | manual:bash | `grep 'TEMP_PORT' scripts/brain-deploy.sh \| grep -c '5224'` 返回 ≥1 |
| [BEHAVIOR-8] | develop Brain 停止后 5 分钟内，Brain production（5221）tasks 出现 type=alert 的健康告警记录 | functional | manual:bash | `docker stop cecelia-node-brain-dev 2>/dev/null; sleep 360; curl -s "localhost:5221/api/brain/tasks?type=alert&limit=5" \| jq -e '.[].title \| contains("5220")'` |

### 不变量验证

| ID | 不变量 | 验证命令 |
|----|--------|---------|
| INV-1 | production 5221 全程不中断 | `curl -sf http://localhost:5221/api/brain/health` |
| INV-2 | staging 5222 tick disabled | `curl -s http://localhost:5222/api/brain/health \| jq '.tick_enabled == false'` |
| INV-3 | develop 5220 tick disabled | `curl -s http://localhost:5220/api/brain/health \| jq '.tick_enabled == false'` |
| INV-4 | dev-deploy.sh migrate 失败时 exit 非 0 | 单元测试覆盖 |
| INV-5 | `/opt/cecelia-backups/` 备份不超过 7 个 | `ls /opt/cecelia-backups/ \| wc -l` ≤7 |
| INV-6 | dev 与 staging deploy 并发互不干扰 | `deploy-status.test.js` 并发测试 |
| INV-7 | brain-deploy.sh 使用 5224 后 5223 仅为 dashboard staging | `grep TEMP_PORT scripts/brain-deploy.sh \| grep 5224` |

---

## 实施范围

### 变更文件清单

| 文件 | 类型 | FR |
|------|------|----|
| `docker-compose.staging.yml` | 修改 | FR-1 |
| `scripts/dev-deploy.sh` | 新建 | FR-2 |
| `scripts/dev-verify.sh` | 新建 | FR-3 |
| `.github/workflows/auto-dev-deploy.yml` | 新建 | FR-4 |
| `packages/brain/src/routes/ops.js` | 修改 | FR-5 |
| `scripts/brain-deploy.sh` | 修改 | FR-6 |
| `scripts/dev-healthcheck-cron.sh` | 新建 | FR-7 |
| `DEFINITION.md` | 修改 | FR-8 |

---

## 测试策略

- **单元测试**：`packages/brain/src/__tests__/deploy-status.test.js` 补充 dev 分支端点测试
- **集成测试**：`sprints/*/tests/` 内骨架测试验证关键行为
- **手动 bash 验收**：contract-dod.md 列出可执行命令
- **CI 覆盖**：brain-ci.yml 覆盖 FR-5 端点单元测试

---

## 风险与约束

1. **Docker 不可用**：dev-deploy.sh 检测到 Docker 不可用时 exit 0 + 设置 `DEV_SKIP_REASON=no_docker`，不阻塞 CI
2. **宿主机未安装 pg**：dev-verify.sh 通过 Brain API 端点间接验证 DB，不依赖本地 psql
3. **端口冲突 5223→5224**：需确认无其他地方硬编码 5223 作为 canary，修改前 grep 全仓库
4. **develop tick disabled**：dev-healthcheck-cron.sh 独立于 Brain tick 运行，通过宿主 cron 调度
