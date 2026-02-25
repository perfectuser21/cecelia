# Intent Recognition API (KR1)

Natural language to OKR/Project/Task intent recognition system.

## API Endpoints

### POST /api/intent/recognize

Recognize intent from natural language input.

**Request:**
```json
{
  "text": "实现用户登录接口",
  "context": {
    "currentProject": "cecelia-workspace",
    "currentGoal": "user-authentication"
  },
  "confidenceThreshold": 0.3
}
```

**Response:**
```json
{
  "success": true,
  "result": {
    "intent": "CREATE_TASK",
    "confidence": 0.85,
    "confidenceLevel": "high",
    "entities": {
      "title": "用户登录接口",
      "priority": "P1"
    },
    "originalInput": "实现用户登录接口",
    "matchedPhrases": ["实现", "接口"],
    "requiresConfirmation": false,
    "explanation": "识别为创建任务意图 (85% 确信度)，任务名称: \"用户登录接口\""
  },
  "suggestedAction": {
    "action": "create-task",
    "params": {
      "title": "用户登录接口",
      "priority": "P1"
    },
    "confidence": 0.85
  }
}
```

### GET /api/intent/health

Health check endpoint.

**Response:**
```json
{
  "status": "healthy",
  "service": "intent-recognition",
  "version": "1.0.0"
}
```

## Supported Intent Types

- `CREATE_GOAL` - Create a high-level objective
- `CREATE_PROJECT` - Create a new project
- `CREATE_TASK` - Create a specific task
- `QUERY_TASKS` - Query existing tasks
- `UPDATE_TASK` - Update task status
- `UNKNOWN` - Unable to recognize intent

## Examples

### Create Task
```
Input: "实现用户登录接口"
Intent: CREATE_TASK
Entities: { title: "用户登录接口", priority: "P1" }
```

### Create Goal
```
Input: "完成整个用户认证系统作为 P0 目标"
Intent: CREATE_GOAL
Entities: { title: "用户认证系统", priority: "P0" }
```

### Query Tasks
```
Input: "我有哪些待办任务"
Intent: QUERY_TASKS
Entities: { status: "pending" }
```

### Update Task
```
Input: "把登录功能标记为完成"
Intent: UPDATE_TASK
Entities: { title: "登录功能", status: "completed" }
```

## Integration with Brain API

The service provides `suggestedAction` that can be directly used with Brain API:

```bash
curl -X POST http://localhost:5212/api/intent/recognize \
  -H "Content-Type: application/json" \
  -d '{"text": "实现用户登录接口"}'
```

Then use the suggested action:

```bash
curl -X POST http://localhost:5212/api/brain/action/create-task \
  -H "Content-Type: application/json" \
  -d '{"title": "用户登录接口", "priority": "P1"}'
```

## Performance

- Target response time: < 500ms
- Uses lightweight rule-based NLP (no ML models)
- Stateless design for horizontal scaling
