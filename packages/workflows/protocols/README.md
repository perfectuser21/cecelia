# Cecelia Protocols

系统运行的核心协议，所有角色必须遵守。

## 文件说明

| 文件 | 说明 |
|------|------|
| task-envelope.json | Task Envelope Schema（任务合同） |
| state-machine.md | 状态机定义 |
| dispatch-rules.md | 调度规则 |
| redline-policies.md | 红线策略（小审专用） |

## 核心原则

### 1. 统一任务协议（Task Envelope）

所有任务必须按 `task-envelope.json` 格式传递，不允许"凭感觉"。

### 2. 单一真相源（State Store）

- 所有状态写入 Core DB（`/api/orchestrator/v2/*`）
- 所有人只读/只写这一个地方
- 每一步必须写回执（evidence）

### 3. QA/Audit 的打回权力

- 小检/小审有硬权限打回任务
- 打回后任务状态变为 `rejected`
- 必须说明原因和要求的修正动作

## Task Envelope 示例

```json
{
  "task_id": "task-a1b2c3d4",
  "owner": "autumnrice",
  "executor": "xiaoxi",
  "goal": "爬取小红书热门 50 条",
  "inputs": {
    "params": {
      "platform": "xiaohongshu",
      "count": 50,
      "category": "hot"
    }
  },
  "constraints": [
    "不超过 100 条",
    "不爬取私密内容"
  ],
  "definition_of_done": [
    "返回 JSON 数组",
    "每条包含 title, url, likes, author"
  ],
  "evidence_required": ["json_output", "log"],
  "status": "queued",
  "handoff_to": "xiaojian"
}
```

## 状态流转

```
queued → assigned → running → success/failed
                         ↓
                    [QA 审核]
                         ↓
                 rejected → queued (重新派发)
```
