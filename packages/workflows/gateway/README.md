# AI Gateway

统一 AI 调用网关，根据环境变量选择后端。

## 架构

```
N8N Workflow
     │
     ▼
┌─────────────────────────────────────┐
│  AI Gateway (:9876)                 │
│  POST /execute { prompt }           │
├─────────────────────────────────────┤
│  美国 (AI_MODE=claude-code)         │
│    → 启动 Claude Code 无头          │
│                                     │
│  香港 (AI_MODE=minimax)             │
│    → 调用 MiniMax API               │
└─────────────────────────────────────┘
```

## API

### POST /execute
提交任务
```json
{ "prompt": "你的提示词" }
```
返回:
```json
{ "taskId": "task-xxx", "status": "submitted", "mode": "claude-code" }
```

### GET /result/:taskId
查询结果
```json
{ "status": "completed", "result": "...", "completedAt": "..." }
```

### GET /health
健康检查

### GET /status
查看所有任务状态

## 启动

### 美国 (Claude Code)
```bash
AI_MODE=claude-code node ai-gateway.cjs
# 或用 pm2
pm2 start ecosystem.config.js --env us
```

### 香港 (MiniMax)
```bash
AI_MODE=minimax \
MINIMAX_API_KEY=xxx \
MINIMAX_GROUP_ID=xxx \
node ai-gateway.cjs
# 或用 pm2
pm2 start ecosystem.config.js --env hk
```

## N8N 配置

N8N 环境变量:
```
AI_GATEWAY_URL=http://localhost:9876
```

Workflow 中使用:
```
URL: {{ $env.AI_GATEWAY_URL }}/execute
```
