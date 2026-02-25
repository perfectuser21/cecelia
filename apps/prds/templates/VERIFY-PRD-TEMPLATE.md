---
id: prd-<feature>-verify
version: 1.0.0
created: YYYY-MM-DD
depends_on:
  - prd-<feature>-01
  - prd-<feature>-02
  - prd-<feature>-03
  - prd-<feature>-04
  - prd-<feature>-05
---

# PRD: <Feature Name> 验收与清理

## 目标
确保所有 PRD 完成后系统整体可用，执行集成测试和清理工作。

## 背景
本 PRD 是 `<Feature Name>` 系列的最后一步，负责：
1. 验证所有组件正确集成
2. 执行数据库迁移
3. 重启服务加载新代码
4. 运行端到端测试
5. 清理临时文件和冗余代码

---

## 功能需求

### 1. 数据库迁移检查

```bash
# 检查待执行的迁移
ls -la apps/core/migrations/

# 执行迁移（生产环境）
psql $DATABASE_URL -f apps/core/migrations/xxx.sql

# 验证表结构
psql $DATABASE_URL -c "\d+ <table_name>"
```

**验收**：
- [ ] 所有迁移已执行
- [ ] 表结构符合预期
- [ ] 无遗留的 pending 迁移

---

### 2. 服务重启

```bash
# 重启服务加载新代码
fuser -k <port>/tcp
cd apps/core && node dist/dashboard/server.js &

# 验证服务状态
curl http://localhost:<port>/api/health
```

**验收**：
- [ ] 服务正常启动
- [ ] 所有新 API 端点可访问
- [ ] 无启动错误日志

---

### 3. 集成测试

#### 3.1 API 测试

```bash
# 测试新增的 API 端点
curl -s http://localhost:<port>/api/<new-endpoint> | jq

# 验证响应格式
curl -s http://localhost:<port>/api/<new-endpoint> | jq 'keys'
```

#### 3.2 前端测试

```bash
# 访问新页面
curl -s http://localhost:<port>/<new-page> | grep -o '<title>.*</title>'

# 或使用 chrome-devtools MCP 截图验证
```

**验收**：
- [ ] 所有 API 返回正确格式
- [ ] 前端页面可访问
- [ ] 无控制台错误

---

### 4. 端到端流程测试

按照实际用户流程测试完整功能：

```bash
# Step 1: 创建数据
curl -X POST http://localhost:<port>/api/xxx -d '{"field": "value"}'

# Step 2: 验证数据
curl http://localhost:<port>/api/xxx/:id

# Step 3: 触发自动化
curl -X POST http://localhost:<port>/api/xxx/trigger

# Step 4: 验证结果
curl http://localhost:<port>/api/xxx/status
```

**验收**：
- [ ] 完整流程无错误
- [ ] 数据一致性正确
- [ ] 自动化机制正常触发

---

### 5. 测试套件

```bash
# 运行所有测试
cd apps/core && npm test

# 验证测试覆盖率
npm run test:coverage
```

**验收**：
- [ ] 所有单元测试通过
- [ ] 无跳过的测试
- [ ] 新功能有对应测试

---

### 6. 代码清理

#### 6.1 删除临时文件

```bash
# 检查临时文件
find . -name "*.tmp" -o -name "*.bak" -o -name "*~"

# 检查注释掉的代码
grep -r "// TODO" apps/core/src/<feature>/
grep -r "console.log" apps/core/src/<feature>/
```

#### 6.2 删除未使用的导入

```bash
# 运行 linter
cd apps/core && npm run lint
```

#### 6.3 更新文档

- [ ] README 更新（如需要）
- [ ] API 文档更新
- [ ] CHANGELOG 更新

**验收**：
- [ ] 无临时文件
- [ ] 无调试代码
- [ ] Lint 无错误

---

### 7. 性能检查

```bash
# API 响应时间
time curl http://localhost:<port>/api/<endpoint>

# 数据库查询性能
psql $DATABASE_URL -c "EXPLAIN ANALYZE SELECT * FROM <table> WHERE ..."
```

**验收**：
- [ ] API 响应 < 200ms
- [ ] 数据库查询有索引
- [ ] 无 N+1 查询问题

---

### 8. 监控配置（可选）

```bash
# 添加 n8n 自动化工作流
# 例如：30分钟 tick 机制
```

**验收**：
- [ ] 定时任务已配置
- [ ] 告警规则已设置

---

## 最终验收清单

### 功能完整性
- [ ] 所有 PRD 需求已实现
- [ ] 边界情况已处理
- [ ] 错误处理完善

### 技术质量
- [ ] 测试覆盖充分
- [ ] 代码风格一致
- [ ] 无安全漏洞

### 运维就绪
- [ ] 可部署到生产
- [ ] 回滚方案明确
- [ ] 监控已配置

---

## 完成标志

当以上所有检查项通过后，本功能开发完成。

输出 `<promise>DONE</promise>` 表示验收通过。
