# File Formats Reference - Cecelia Quality Platform

本文档定义了 Cecelia Quality Platform 中所有文件的格式规范。

---

## 1. Queue Format - `queue/queue.jsonl`

**格式**: JSON Lines（每行一个 JSON 对象）

**作用**: 存储待执行的任务队列，按优先级排序

**示例**:

```jsonl
{"taskId":"550e8400-e29b-41d4-a716-446655440000","source":"cloudcode","intent":"runQA","priority":"P0","payload":{"project":"cecelia-quality","branch":"develop","scope":"pr"},"createdAt":"2026-01-27T14:30:00Z"}
{"taskId":"550e8400-e29b-41d4-a716-446655440001","source":"notion","intent":"fixBug","priority":"P1","payload":{"project":"zenithjoy-engine","issue":"#123"},"createdAt":"2026-01-27T14:31:00Z"}
{"taskId":"550e8400-e29b-41d4-a716-446655440002","source":"heartbeat","intent":"optimizeSelf","priority":"P2","payload":{"anomaly":"high_failure_rate"},"createdAt":"2026-01-27T14:32:00Z"}
```

**Priority Order**: P0 > P1 > P2 (Worker dequeues highest priority first)

**字段说明**:

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `taskId` | string (UUID) | ✅ | 唯一任务 ID |
| `source` | enum | ✅ | cloudcode, notion, chat, n8n, webhook, heartbeat |
| `intent` | enum | ✅ | runQA, fixBug, refactor, review, summarize, optimizeSelf |
| `priority` | enum | ✅ | P0 (critical), P1 (high), P2 (normal) |
| `payload` | object | ✅ | 任务特定数据（见 gateway/task-schema.json） |
| `createdAt` | ISO 8601 | ✅ | 任务创建时间 |

## State Format (state/state.json)

Global system health summary:

```json
{
  "health": "ok",
  "queueLength": 3,
  "lastRun": {
    "taskId": "550e8400-e29b-41d4-a716-446655440000",
    "intent": "runQA",
    "status": "completed",
    "completedAt": "2026-01-27T14:35:00Z"
  },
  "lastHeartbeat": "2026-01-27T14:40:00Z",
  "stats": {
    "totalTasksProcessed": 42,
    "successRate": 0.95,
    "avgExecutionTimeSeconds": 180
  },
  "anomalies": []
}
```

## Run Summary Format (runs/\<runId\>/summary.json)

Single execution summary:

```json
{
  "runId": "550e8400-e29b-41d4-a716-446655440000",
  "taskId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "completed",
  "intent": "runQA",
  "priority": "P0",
  "source": "cloudcode",
  "startedAt": "2026-01-27T14:30:15Z",
  "completedAt": "2026-01-27T14:35:42Z",
  "durationSeconds": 327,
  "exitCode": 0,
  "workspace": "/tmp/worktree-550e8400",
  "evidence": [
    {
      "type": "qa_report",
      "path": "evidence/qa-report.json",
      "sizeBytes": 4521
    },
    {
      "type": "test_result",
      "path": "evidence/test-results.xml",
      "sizeBytes": 12840
    },
    {
      "type": "audit_report",
      "path": "evidence/audit-report.md",
      "sizeBytes": 3201
    }
  ],
  "metadata": {
    "project": "cecelia-quality",
    "branch": "develop",
    "commit": "a1b2c3d4",
    "prUrl": "https://github.com/owner/repo/pull/123"
  }
}
```

## Evidence Directory Structure

```
runs/
└── <runId>/
    ├── task.json           # Original task definition
    ├── summary.json        # Execution summary (above format)
    ├── worker.log          # Worker execution log
    └── evidence/
        ├── qa-report.json      # QA orchestrator output
        ├── test-results.xml    # Test execution results
        ├── audit-report.md     # Audit findings
        ├── coverage.html       # Code coverage report
        └── screenshots/        # Visual evidence (if applicable)
            ├── before.png
            └── after.png
```

## Inbox Format (Raw incoming tasks)

Before processing into tasks table:

```json
{
  "id": "inbox-uuid",
  "source": "notion",
  "rawPayload": "{\"title\":\"Fix login bug\",\"status\":\"待执行\",\"priority\":\"P1\"}",
  "processed": false,
  "createdAt": "2026-01-27T14:00:00Z"
}
```

## Notion Sync Tracking

```json
{
  "entityType": "run",
  "entityId": "550e8400-e29b-41d4-a716-446655440000",
  "notionPageId": "abc123def456",
  "lastSyncedAt": "2026-01-27T14:36:00Z",
  "syncStatus": "synced"
}
```
