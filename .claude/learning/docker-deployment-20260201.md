# Learning: Docker Compose 24/7 部署

**日期**: 2026-02-01
**分支**: cp-docker-24x7-deployment
**PR**: #54

## 完成的工作

实现了 Cecelia 的 Docker Compose 统一部署，支持 24/7 自主运行。

### 主要变更

1. **Docker Compose 配置** (docker-compose.yml)
   - semantic-brain (Python, 5220)
   - node-brain (Node.js, 5221)
   - 健康检查（30s 间隔，3 次重试）
   - 自动重启（unless-stopped）
   - 日志轮转（10MB × 3 文件）

2. **环境变量管理** (.env.docker)
   - 数据库凭据
   - OpenAI API Key
   - Tick 配置（间隔、并发、超时）

3. **运维文档**
   - DOCKER.md：完整运维手册
   - README.md：快速开始指南
   - scripts/verify-deployment.sh：部署验证脚本

4. **配置优化**
   - .dockerignore：优化构建
   - npm install 条件执行（避免每次启动都安装）

## 遇到的问题

### 1. CI 失败：未使用的 import

**问题**: ruff 检查发现 `src/api/orchestrator_routes.py` 有未使用的 `hashlib` 导入。

**原因**: 虽然本次改动是 Docker 配置，但 CI 检查全部代码。

**解决**: 移除未使用的导入后重新推送。

**教训**: CI 检查是全局的，即使只改配置文件也要确保现有代码通过 linting。

### 2. .env.docker 配置遗漏

**问题**: 初始版本缺少 `DB_NAME` 变量。

**原因**: 复制凭据时只包含了部分变量。

**解决**: 审计阶段发现并修复（L1 问题）。

**教训**: 配置文件要对照 docker-compose.yml 的默认值，确保所有必需变量都显式配置。

### 3. 硬编码密码默认值

**问题**: docker-compose.yml 中 `DB_PASSWORD` 有硬编码的默认值。

**原因**: 从旧配置迁移时没有清理。

**解决**: 审计阶段发现并修复（L2 问题）。

**教训**: 敏感信息不应该有默认值，应该强制从 .env.docker 读取。

## 关键决策

### 1. 网络模式：host vs bridge

**选择**: host 模式

**原因**:
- 需要访问本地 PostgreSQL（social-metrics-postgres 容器）
- 简化配置，无需端口映射
- 性能更好（无 NAT 开销）

**权衡**: 牺牲了容器间网络隔离

### 2. npm install 优化

**原始**: 每次启动都执行 `npm install`

**优化**: 条件安装 `test -d node_modules || npm install`

**原因**: brain 目录已挂载，node_modules 已存在，无需重复安装

**效果**: 启动时间从 ~30s 降到 ~5s

### 3. 日志管理策略

**配置**:
- 驱动：json-file
- 大小：10MB/文件
- 数量：3 个文件

**原因**:
- json-file 易于查看和解析
- 10MB × 3 = 30MB 总容量，适合单机部署
- 自动轮转，无需手动清理

**替代方案**: 如果任务量 > 100/天，考虑 syslog 或 Loki

## 最佳实践

### 1. 审计分层

严格遵守 L1/L2/L3/L4 分层：
- L1 (阻塞性): 配置缺失、语法错误 → 必须修
- L2 (功能性): 默认值不当、错误处理缺失 → 建议修
- L3 (最佳实践): 代码风格 → 可选
- L4 (过度优化): 理论问题 → 不修

**本次审计**: 1个L1 + 3个L2，全部修复，未深入 L3/L4。

### 2. 配置文件安全

- `.env.docker` 包含敏感信息，必须加入 `.gitignore`
- 凭据从 `~/.credentials/` 加载（全局凭据系统）
- 不要在 docker-compose.yml 中硬编码密码

### 3. 健康检查设计

```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:5221/api/brain/tick/status"]
  interval: 30s      # 检查间隔
  timeout: 10s       # 单次超时
  retries: 3         # 失败重试次数
  start_period: 40s  # 启动等待时间
```

**关键点**:
- 端点要轻量（不要触发复杂逻辑）
- start_period 要大于服务启动时间
- interval 和 timeout 配合，避免误判

## 性能指标

| 指标 | 值 | 备注 |
|------|---|------|
| 构建时间 | ~2 分钟 | Python 依赖较多 |
| 启动时间 | ~10 秒 | 健康检查 start_period=40s |
| 内存占用 | ~500MB | 空闲时（两个服务合计） |
| 日志空间 | 30MB/服务 | 10MB × 3 文件轮转 |

## 下一步优化

1. **监控增强**
   - 添加 Prometheus metrics
   - Grafana 监控面板

2. **性能优化**（任务量 > 100/天 时）
   - 提高并发：MAX_CONCURRENT_TASKS=5
   - 缩短 Tick 间隔：120000ms → 60000ms

3. **安全加固**
   - 容器用户非 root
   - 只读文件系统（部分目录）
   - 限制 capabilities

4. **备份策略**
   - data/chroma 向量数据定期备份
   - logs 定期归档到对象存储

## 参考资料

- Docker Compose 健康检查：https://docs.docker.com/compose/compose-file/05-services/#healthcheck
- Docker 日志驱动：https://docs.docker.com/config/containers/logging/configure/
- ruff linting 规则：https://docs.astral.sh/ruff/rules/

