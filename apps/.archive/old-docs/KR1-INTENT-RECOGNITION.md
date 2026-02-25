---
id: kr1-intent-recognition-doc
version: 1.0.0
created: 2026-02-01
updated: 2026-02-01
changelog:
  - 1.0.0: 初始版本 - KR1 意图识别功能文档
---

# KR1: Intent Recognition - 自然语言→OKR/Project/Task

## 概述

Intent Recognition（意图识别）功能将自然语言输入转换为结构化的系统操作，支持创建和查询 OKR、Project 和 Task。

### 核心能力

1. **意图分类**：识别用户输入属于哪种操作类型
2. **实体提取**：从自然语言中提取关键信息（标题、优先级、时间等）
3. **上下文管理**：支持省略信息的补全和引用解析
4. **API 接口**：提供标准化的 HTTP API 供外部调用

## 架构设计

### 文件结构

```
apps/core/src/brain/
├── intent.js                    # 意图分类和实体提取核心逻辑
├── context-manager.js           # 上下文管理器（会话状态、代词解析）
├── routes.js                    # Brain API 路由（包含 intent 相关端点）
└── __tests__/
    ├── intent.test.js          # Intent 核心逻辑测试
    ├── context-manager.test.js # Context Manager 测试
    ├── intent-api.test.js      # API 端点集成测试
    └── intent-integration.test.js # 端到端集成测试
```

### 数据流

```
用户输入
    ↓
Intent Classifier (classifyIntent)
    ↓
Entity Extractor (extractEntities)
    ↓
Context Manager (resolvePronoun)
    ↓
返回结构化结果
```

## API 使用指南

### 1. 意图识别 API

**端点**: `POST /api/brain/intent`

**功能**: 识别意图并提取实体，返回简化格式

**请求示例**:
```bash
curl -X POST http://localhost:5212/api/brain/intent \
  -H "Content-Type: application/json" \
  -d '{
    "text": "创建一个高优先级目标：完成用户认证系统",
    "context": {
      "session_id": "session-123"
    }
  }'
```

**响应示例**:
```json
{
  "intent": "create_goal",
  "entities": {
    "priority": "P0",
    "title": "完成用户认证系统"
  },
  "confidence": 0.95
}
```

**失败响应**（无法识别）:
```json
{
  "intent": "unknown",
  "entities": {},
  "confidence": 0,
  "suggestions": ["create_goal", "create_task", "query_status", "create_feature"]
}
```

### 2. 上下文引用示例

**第一次调用**（创建目标）:
```bash
curl -X POST http://localhost:5212/api/brain/intent/create \
  -H "Content-Type: application/json" \
  -d '{
    "input": "创建一个 P0 目标：优化系统性能",
    "options": {
      "createGoal": true,
      "session_id": "session-abc"
    }
  }'
```

返回：
```json
{
  "success": true,
  "created": {
    "goal": {
      "id": "goal-456",
      "title": "优化系统性能",
      "priority": "P0"
    }
  }
}
```

**第二次调用**（使用代词引用）:
```bash
curl -X POST http://localhost:5212/api/brain/intent \
  -H "Content-Type: application/json" \
  -d '{
    "text": "给那个目标添加一个任务：减少 API 响应时间",
    "context": {
      "session_id": "session-abc"
    }
  }'
```

返回（自动关联到上一次创建的 goal）:
```json
{
  "intent": "create_task",
  "entities": {
    "title": "减少 API 响应时间",
    "resolved_entity": {
      "type": "goal",
      "id": "goal-456",
      "title": "优化系统性能"
    }
  },
  "confidence": 0.85
}
```

## 支持的意图类型

### 创建类意图

| 意图 | 说明 | 示例 |
|------|------|------|
| `create_goal` | 创建目标 | "创建一个 P0 目标：提升系统稳定性" |
| `create_task` | 创建任务 | "添加一个任务：修复登录超时" |
| `create_project` | 创建项目 | "我想做一个 GMV Dashboard" |
| `create_feature` | 添加功能 | "给登录页面加一个忘记密码功能" |

### 查询类意图

| 意图 | 说明 | 示例 |
|------|------|------|
| `query_status` | 查询状态 | "当前有哪些进行中的任务？" |
| `query_goal` | 查询目标 | "认证系统目标进展怎么样？" |

### 其他意图

| 意图 | 说明 | 示例 |
|------|------|------|
| `fix_bug` | 修复 Bug | "修复购物车页面的价格显示问题" |
| `refactor` | 重构代码 | "重构用户模块的代码结构" |
| `explore` | 探索/调研 | "帮我看看这个 API 怎么用" |
| `question` | 提问 | "为什么这里会报错？" |
| `unknown` | 无法识别 | （低置信度时返回） |

## 实体提取规则

### 优先级映射

| 关键词 | 标准值 |
|--------|--------|
| P0, 高优先级, 高优, 紧急, critical | `P0` |
| P1, 中优先级, 中优, 普通, normal | `P1` |
| P2, 低优先级, 低优 | `P2` |

### 时间解析

| 关键词 | 解析结果 |
|--------|----------|
| 今天 | 当天日期 |
| 明天 | 次日日期 |
| 本周 | 本周结束日期 |
| 本月 | 本月结束日期 |

### 其他实体

- **模块/系统名称**: "xxx模块"、"xxx系统"、"xxx平台"
- **功能名称**: "xxx功能"、"xxx特性"
- **文件路径**: `src/xxx.js`、`apps/core/xxx.ts`
- **API端点**: `/api/xxx`

## 上下文管理

### 会话隔离

每个 session_id 对应一个独立的上下文，不同会话之间互不干扰。

### 实体存储

- 每个会话最多存储 10 个最近的实体
- 实体按时间排序（最新的在前）
- 会话超时时间：30 分钟

### 代词解析

支持的代词模式：
- "那个目标" → 最近提到的 goal
- "那个任务" → 最近提到的 task
- "它" → 最近提到的任何实体
- "this goal", "that task" → 英文代词

### Context Stats API

查看上下文管理器状态：

```bash
curl http://localhost:5212/api/brain/intent/context-stats
```

返回：
```json
{
  "success": true,
  "stats": {
    "totalSessions": 5,
    "activeSessions": 3,
    "totalEntities": 15,
    "oldestSession": "2026-02-01T06:00:00Z",
    "newestSession": "2026-02-01T07:00:00Z"
  }
}
```

## 测试方法

### 运行单元测试

```bash
# 测试意图识别核心逻辑
npm test -- apps/core/src/brain/__tests__/intent.test.js

# 测试上下文管理器
npm test -- apps/core/src/brain/__tests__/context-manager.test.js

# 测试 API 端点
npm test -- apps/core/src/brain/__tests__/intent-api.test.js

# 端到端集成测试
npm test -- apps/core/src/brain/__tests__/intent-integration.test.js
```

### 测试覆盖率

```bash
npm test -- apps/core/src/brain/__tests__/intent.test.js --coverage
```

目标：>=80% 覆盖率

### 手动测试

```bash
# 1. 启动服务
npm run dev

# 2. 测试意图识别
curl -X POST http://localhost:5212/api/brain/intent \
  -H "Content-Type: application/json" \
  -d '{"text": "创建一个高优先级目标：完成用户系统"}' | jq

# 3. 测试上下文引用
# （先创建一个 goal，然后用代词引用）
```

## 性能指标

- **响应时间**: < 2s（使用简单规则匹配）
- **准确率**: >= 85%（基于 20 个测试用例）
- **并发支持**: 支持多会话并发（session 隔离）

## 已知限制

1. **不支持复杂对话**: 只处理单次输入，不支持多轮对话管理
2. **仅中英文**: 其他语言未经测试
3. **简单规则匹配**: 未集成大型 NLP 模型
4. **歧义不自动消解**: 如果识别不确定，返回 suggestions 供用户选择

## 未来改进方向

1. 集成机器学习模型提升准确率
2. 支持多轮对话和上下文补全
3. 添加用户反馈机制改进意图识别
4. 支持更多语言
5. 优化性能到 ms 级响应

## 相关文档

- [PRD - KR1 Intent Recognition](../.prd-kr1-intent-recognition.md)
- [DoD - KR1 Intent Recognition](../.dod-kr1-intent-recognition.md)
- [QA Decision](./QA-DECISION.md)
- [Brain API 总览](./BRAIN-API.md)

## 维护者

- Brain 团队
- 问题反馈：GitHub Issues
