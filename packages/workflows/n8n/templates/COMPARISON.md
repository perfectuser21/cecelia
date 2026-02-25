# N8N Claude 模板对比

## 快速选择指南

| 需求 | 推荐模板 |
|------|---------|
| 简单问答、执行单个命令 | 01 - Simple Call |
| 读取文件并分析 | 02 - File Processor |
| 完整开发流程（PR/CI） | 03 - Dev Flow |
| 定期自动执行 | 04 - Scheduled |
| 批量处理多个任务 | 05 - Batch Processor |

---

## 详细对比

| 特性 | 01-Simple | 02-File | 03-Dev | 04-Scheduled | 05-Batch |
|------|-----------|---------|--------|--------------|----------|
| **触发方式** | Webhook | Webhook | Webhook | Cron | Webhook |
| **并发控制** | ❌ | ❌ | ✅ (cecelia-run) | ❌ | ✅ (批量限流) |
| **文件处理** | ❌ | ✅ | ✅ | ✅ | ✅ |
| **完整流程** | ❌ | ❌ | ✅ (/dev) | ❌ | ❌ |
| **批量任务** | ❌ | ❌ | ❌ | ❌ | ✅ |
| **定时执行** | ❌ | ❌ | ❌ | ✅ | ❌ |
| **平均耗时** | < 1 分钟 | 1-3 分钟 | 5-30 分钟 | 可变 | 可变 |
| **复杂度** | ⭐ | ⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐ |

---

## 节点结构对比

### 01 - Simple Call
```
Webhook → Prepare → SSH (Claude) → Parse → Respond
                                       ↓ Error
                                    Handle Error
```
**节点数**: 6

### 02 - File Processor
```
Webhook → Prepare → Create File → SSH (Claude) → Cleanup → Format → Respond
```
**节点数**: 7

### 03 - Dev Flow
```
Webhook → Build → Prepare → Save → SSH (cecelia-run) → Parse → Cleanup → Respond
```
**节点数**: 8
**特殊**: 使用 `cecelia-run` 带并发锁

### 04 - Scheduled
```
Cron → Prepare → SSH (Claude) → Format → Notify (Optional)
```
**节点数**: 5
**特殊**: Cron 触发器

### 05 - Batch
```
Webhook → Split → Batch Limit → SSH (Claude) → Collect → Cleanup → Check → Aggregate → Respond
                      ↑                                                    ↓
                      └──────────────────────────────── Loop ─────────────┘
```
**节点数**: 9
**特殊**: 循环批处理

---

## 输入输出格式

### 01 - Simple Call

**输入**:
```json
{
  "prompt": "你的任务描述",
  "task_id": "可选"
}
```

**输出**:
```json
{
  "success": true,
  "task_id": "task-xxx",
  "result": { /* Claude 结果 */ },
  "executed_at": "2026-01-25T10:00:00Z"
}
```

---

### 02 - File Processor

**输入**:
```json
{
  "file_path": "/path/to/input.txt",
  "task": "分析这个文件",
  "output_path": "/path/to/output.json"
}
```

**输出**:
```json
{
  "success": true,
  "task_id": "file-task-xxx",
  "file_processed": "/path/to/input.txt",
  "output_saved": "/path/to/output.json",
  "result": { /* 分析结果 */ }
}
```

---

### 03 - Dev Flow

**输入**:
```json
{
  "project": "my-project",
  "repo_path": "/home/xx/dev/my-project",
  "prd": "功能需求描述...",
  "checkpoint": "CP-001"
}
```

**输出**:
```json
{
  "success": true,
  "task_id": "my-project-20260125-a1b2",
  "checkpoint": "CP-001",
  "project": "my-project",
  "result": {
    "pr_url": "https://github.com/...",
    "branch": "cp-01251000-feature",
    "ci_status": "passed"
  },
  "executed_at": "2026-01-25T10:00:00Z"
}
```

---

### 04 - Scheduled

**输入**: 无（Cron 触发）

**输出**:
```json
{
  "success": true,
  "task_id": "scheduled-20260125-0200",
  "task_type": "scheduled",
  "executed_at": "2026-01-25T02:00:00Z",
  "result": { /* 定时任务结果 */ }
}
```

---

### 05 - Batch

**输入**:
```json
{
  "batch_id": "可选",
  "tasks": [
    {"prompt": "任务 1", "metadata": {}},
    {"prompt": "任务 2", "metadata": {}},
    {"prompt": "任务 3", "metadata": {}}
  ]
}
```

**输出**:
```json
{
  "batch_id": "batch-xxx",
  "total_tasks": 3,
  "successful": 3,
  "results": [
    {
      "task_id": "batch-xxx-0",
      "task_index": 0,
      "success": true,
      "result": { /* 任务 1 结果 */ }
    },
    // ...
  ]
}
```

---

## 使用场景示例

### 01 - Simple Call

✅ **适合**:
- 快速问答
- 单个命令执行
- API 集成（简单响应）

❌ **不适合**:
- 长时间任务（> 2 分钟）
- 需要文件处理
- 批量任务

**示例**:
```bash
# 快速查询
curl -X POST localhost:5679/webhook/simple-claude \
  -d '{"prompt": "npm 最新版本是多少？"}'
```

---

### 02 - File Processor

✅ **适合**:
- 日志分析
- 文档处理
- 代码审查
- 数据提取

❌ **不适合**:
- 不需要文件 I/O 的任务
- 批量文件处理（用 05）

**示例**:
```bash
# 分析日志文件
curl -X POST localhost:5679/webhook/claude-file-process \
  -d '{
    "file_path": "/var/log/app.log",
    "task": "找出所有 ERROR 并分类",
    "output_path": "/tmp/error-report.json"
  }'
```

---

### 03 - Dev Flow

✅ **适合**:
- 自动化开发工作流
- Notion → 代码 → PR 全流程
- CI/CD 集成

❌ **不适合**:
- 简单任务（太重）
- 非代码类任务

**示例**:
```bash
# 通过 Webhook 触发开发
curl -X POST localhost:5679/webhook/claude-dev \
  -d '{
    "project": "autopilot",
    "repo_path": "/home/xx/dev/zenithjoy-autopilot",
    "prd": "添加暗黑模式切换按钮"
  }'
```

---

### 04 - Scheduled

✅ **适合**:
- 定期报告
- 数据备份
- 健康检查
- 夜间构建

❌ **不适合**:
- 实时触发任务
- Webhook 驱动任务

**示例**:
```javascript
// 修改 Prepare Task 节点
const prompt = `
每日报告任务:
1. 检查 GitHub Actions 状态
2. 汇总失败的 workflows
3. 发送到 Slack
`;
```

---

### 05 - Batch

✅ **适合**:
- 批量文件处理
- 并发任务（自动限流）
- 数据迁移
- 批量测试

❌ **不适合**:
- 单个任务
- 需要严格顺序的任务

**示例**:
```bash
# 批量分析多个文件
curl -X POST localhost:5679/webhook/claude-batch \
  -d '{
    "tasks": [
      {"prompt": "分析 /logs/2026-01-20.log"},
      {"prompt": "分析 /logs/2026-01-21.log"},
      {"prompt": "分析 /logs/2026-01-22.log"}
    ]
  }'
```

---

## 性能对比

| 模板 | 启动时间 | 平均执行时间 | 并发能力 | 资源占用 |
|------|---------|-------------|---------|---------|
| 01-Simple | < 1s | 10-60s | ❌ | 低 |
| 02-File | < 1s | 30-180s | ❌ | 中 |
| 03-Dev | < 1s | 5-30分钟 | ✅ (最多 3) | 高 |
| 04-Scheduled | 0s (Cron) | 可变 | ❌ | 低-中 |
| 05-Batch | < 1s | 可变 | ✅ (每批 3) | 中-高 |

---

## 组合使用

### 场景 1: 批量开发流程

```
Webhook 触发 → 05-Batch → (多个) 03-Dev → 聚合结果
```

### 场景 2: 定期代码审查 + 文件报告

```
04-Scheduled → 02-File → 发送邮件
```

### 场景 3: Git Hook → 快速检查

```
Git Push → Webhook → 01-Simple → Slack 通知
```

---

## 维护建议

| 模板 | 更新频率 | 维护难度 | 测试建议 |
|------|---------|---------|---------|
| 01-Simple | 低 | ⭐ | curl 测试 |
| 02-File | 中 | ⭐⭐ | 准备测试文件 |
| 03-Dev | 高 | ⭐⭐⭐⭐⭐ | 测试仓库 |
| 04-Scheduled | 中 | ⭐⭐ | 手动触发测试 |
| 05-Batch | 中 | ⭐⭐⭐ | 小批量测试 |

---

## 故障排查

### 常见问题 → 推荐模板

| 问题 | 可能原因 | 解决方案 |
|------|---------|---------|
| 超时 | 任务太重 | 用 03 (cecelia-run) 或增加 timeout |
| 并发冲突 | 无锁控制 | 用 03 或 05（有并发控制） |
| 内存不足 | 批量太大 | 用 05 减少每批数量 |
| Webhook 404 | 未激活 | 检查 workflow active 状态 |
