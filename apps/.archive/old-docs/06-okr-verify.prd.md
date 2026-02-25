---
id: prd-okr-verify
version: 1.0.0
created: 2026-01-29
depends_on:
  - prd-okr-hierarchy
  - prd-okr-tree-api
  - prd-priority-engine
  - prd-action-loop
  - prd-okr-dashboard
---

# PRD: OKR System 验收与清理

## 目标
确保 OKR Tree 系统所有组件正确集成，执行端到端验证。

## 背景
前 5 个 PRD 已完成并合并，本 PRD 负责：
1. 验证数据库迁移已执行
2. 验证服务加载新代码
3. 运行完整 E2E 流程
4. 配置 n8n 定时 Tick

---

## 功能需求

### 1. 数据库迁移验证

```bash
# 检查 goals 表结构
psql $DATABASE_URL -c "\d+ goals"
```

预期输出包含：
- `parent_id` UUID 类型
- `type` VARCHAR(20)
- `weight` DECIMAL(3,2)

**验收**：
- [ ] parent_id 字段存在
- [ ] type 字段存在
- [ ] weight 字段存在
- [ ] idx_goals_parent_id 索引存在

---

### 2. 服务状态验证

```bash
# 检查开发环境服务
curl -s http://localhost:5212/api/health | jq

# 检查新 API 端点
curl -s http://localhost:5212/api/okr/trees | jq
curl -s http://localhost:5212/api/brain/focus | jq
curl -s http://localhost:5212/api/brain/tick/status | jq
```

**验收**：
- [ ] /api/health 返回 200
- [ ] /api/okr/trees 返回 JSON 数组
- [ ] /api/brain/focus 返回焦点信息
- [ ] /api/brain/tick/status 返回 tick 状态

---

### 3. 端到端流程测试

#### 3.1 创建 OKR

```bash
# 创建 Objective + Key Results
curl -X POST http://localhost:5212/api/okr/trees \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Test OKR System",
    "description": "Verify E2E flow",
    "priority": "P1",
    "key_results": [
      {"title": "KR1: API works", "progress": 0, "weight": 0.5},
      {"title": "KR2: Frontend works", "progress": 0, "weight": 0.5}
    ]
  }'
```

记录返回的 Objective ID。

#### 3.2 更新 KR 进度

```bash
# 更新 KR1 进度到 100%
curl -X PATCH http://localhost:5212/api/okr/trees/<O_ID>/key-results/<KR1_ID> \
  -H "Content-Type: application/json" \
  -d '{"progress": 100}'

# 验证 O 进度自动更新为 50%
curl -s http://localhost:5212/api/okr/trees/<O_ID> | jq '.progress'
```

#### 3.3 验证焦点选择

```bash
# 获取焦点，应返回新创建的 OKR
curl -s http://localhost:5212/api/brain/focus | jq
```

#### 3.4 测试 Tick 机制

```bash
# 启用 Tick
curl -X POST http://localhost:5212/api/brain/tick/enable

# 执行一次 Tick
curl -X POST http://localhost:5212/api/brain/tick/execute | jq

# 检查状态
curl -s http://localhost:5212/api/brain/tick/status | jq
```

**验收**：
- [ ] OKR 创建成功
- [ ] KR 进度更新成功
- [ ] O 进度自动计算正确
- [ ] 焦点选择正确
- [ ] Tick 执行成功

---

### 4. 前端验证

访问 https://dev-core.zenjoymedia.media 或 http://localhost:5212

检查项：
- [ ] OKR Dashboard 页面可访问
- [ ] Focus Panel 显示正确
- [ ] OKR Cards 可展开
- [ ] 进度条显示正确
- [ ] 刷新按钮正常工作

---

### 5. 测试套件验证

```bash
cd /home/xx/dev/cecelia-workspace/apps/core
npm test
```

**验收**：
- [ ] 所有测试通过 (94 tests)
- [ ] focus.test.js 通过
- [ ] tick.test.js 通过
- [ ] trees.test.js 通过

---

### 6. n8n Tick 工作流配置

创建 n8n 工作流：
- 触发器：Schedule (每 30 分钟)
- 动作：HTTP POST http://localhost:5212/api/brain/tick/execute

```bash
# 手动测试 webhook
curl -X POST http://localhost:5679/webhook/tick-execute
```

**验收**：
- [ ] 工作流已创建
- [ ] 每 30 分钟触发一次
- [ ] 日志记录正常

---

### 7. 清理

```bash
# 删除测试数据
curl -X DELETE http://localhost:5212/api/okr/trees/<TEST_O_ID>

# 检查无遗留调试代码
grep -r "console.log" apps/core/src/okr/
grep -r "console.log" apps/core/src/brain/focus.js
grep -r "console.log" apps/core/src/brain/tick.js
```

**验收**：
- [ ] 测试数据已清理
- [ ] 无调试日志
- [ ] 无注释代码块

---

## 最终验收清单

### 数据层 ✓
- [ ] 数据库结构正确
- [ ] 索引已创建
- [ ] 数据完整性约束生效

### API 层 ✓
- [ ] 所有端点可访问
- [ ] 响应格式正确
- [ ] 错误处理完善

### 逻辑层 ✓
- [ ] 进度计算正确
- [ ] 焦点选择算法正确
- [ ] Tick 机制正常

### 前端层 ✓
- [ ] 页面渲染正确
- [ ] 交互正常
- [ ] 自动刷新工作

### 运维层 ✓
- [ ] 服务稳定运行
- [ ] 定时任务配置
- [ ] 监控就绪

---

## 完成标志

所有检查项通过后，OKR Tree System v1.0 开发完成。
