# Cecelia Agent 路由表

> 这是实际工作的路由配置，不是理论设计。

---

## 架构层级

```
Alex (老板)
    │
    ▼
Cecelia (管家大脑)
    │   ├── Brain (Node.js, 5221) - 决策中心
    │   ├── Tick Loop - 心跳循环
    │   └── PostgreSQL (HK) - 状态存储
    │
    ▼
Agents (员工) ──────────────────────────────────────────
    │
    ├── Caramel (开发专家)
    │   └── task_type: dev
    │   └── skill: /dev
    │   └── 权限: bypassPermissions (完整代码读写)
    │
    ├── 小检 (代码审查员)
    │   └── task_type: review
    │   └── skill: /review
    │   └── 权限: plan (只读，输出报告)
    │
    ├── 小话 (文档专员)
    │   └── task_type: talk
    │   └── skill: /talk
    │   └── 权限: plan (只写文档)
    │
    ├── Nobel (自动化专家)
    │   └── task_type: automation
    │   └── skill: /nobel
    │   └── 权限: bypassPermissions (调 N8N API)
    │
    └── 小研 (调研员)
        └── task_type: research
        └── skill: 无 (纯对话)
        └── 权限: plan (只读)
```

---

## 路由表（实际工作）

| Agent 名 | task_type | Skill | 权限模式 | 输出产物 | 闭环方式 |
|---------|-----------|-------|---------|---------|---------|
| **Caramel** | `dev` | `/dev` | bypassPermissions | PR + 代码 | PR 合并 |
| **小检** | `review` | `/review` | plan | REVIEW-REPORT.md | 报告存入 DB |
| **小话** | `talk` | `/talk` | plan | 日报/总结.md | 文档存入 DB |
| **Nobel** | `automation` | `/nobel` | bypassPermissions | workflow 结果 | API 回调 |
| **小研** | `research` | 无 | plan | 调研结果 | 结果存入 DB |

### 兼容旧类型

| 旧类型 | 映射到 | 说明 |
|-------|-------|------|
| `qa` | `review` | 合并到审查员 |
| `audit` | `review` | 合并到审查员 |

---

## 权限模式说明

| 模式 | Claude 参数 | 能做什么 | 不能做什么 |
|------|------------|---------|-----------|
| **bypassPermissions** | `--dangerously-skip-permissions` | 读写代码、执行命令 | 无限制 |
| **plan** | `--permission-mode plan` | 读取文件、输出文本 | 修改文件、执行命令 |

---

## 任务闭环流程

### dev 类型 (Caramel)
```
Brain 派发 → Caramel 执行 /dev → PR 创建 → CI 通过 → PR 合并 → 回调 Brain
```

### review 类型 (小检)
```
Brain 派发 → 小检 执行 /review → 输出 REVIEW-REPORT.md
    │
    ├─ PASS → 结果存 DB → 完成
    │
    └─ NEEDS_FIX → 报告中含 PRD → Brain 创建新 dev 任务 → Caramel 修复
```

**关键：review 发现问题后，PRD 写入报告，Brain 读取报告创建 dev 任务。**

### talk 类型 (小话)
```
Brain 派发 → 小话 执行 /talk → 输出日报/总结 → 存入 daily_logs 表 → 完成
```

### automation 类型 (Nobel)
```
Brain 派发 → Nobel 执行 /nobel → 调用 N8N API → 等待 workflow 完成 → 回调 Brain
```

---

## 代码实现位置

| 组件 | 文件 | 职责 |
|------|------|------|
| 路由决策 | `brain/src/executor.js` | `getSkillForTaskType()`, `getPermissionModeForTaskType()` |
| 任务派发 | `brain/src/executor.js` | `triggerCeceliaRun()` |
| 执行桥接 | `/home/xx/bin/cecelia-bridge.js` | 接收请求，启动 cecelia-run |
| 执行器 | `/home/xx/bin/cecelia-run` | 执行 `claude -p` 命令 |
| 回调处理 | `brain/src/routes.js` | `/api/brain/action/update-task` |

---

## 回调闭环 API

任务完成后，cecelia-run 调用回调：

```bash
# 成功
curl -X POST "http://localhost:5212/api/brain/action/update-task" \
  -H "Content-Type: application/json" \
  -d '{"task_id":"xxx","status":"completed"}'

# 失败
curl -X POST "http://localhost:5212/api/brain/action/update-task" \
  -H "Content-Type: application/json" \
  -d '{"task_id":"xxx","status":"failed"}'
```

---

## Review 到 Dev 的闭环

当 review 任务发现需要修复的问题时：

1. **小检输出**：REVIEW-REPORT.md 中包含 `Fix PRD` 部分
2. **Brain 读取**：解析报告，提取 PRD 内容
3. **Brain 创建**：新建 task_type=dev 的任务，PRD 来自报告
4. **Caramel 执行**：/dev 工作流修复问题

```javascript
// Brain 伪代码
async function handleReviewComplete(taskId) {
  const report = await readFile(`${workdir}/REVIEW-REPORT.md`);

  if (report.includes('Fix PRD')) {
    const prd = extractPRD(report);
    await createTask({
      title: `修复: ${extractIssue(report)}`,
      task_type: 'dev',
      prd_content: prd,
      parent_task_id: taskId
    });
  }
}
```

---

## 已废弃的概念

| 概念 | 状态 | 原因 |
|------|------|------|
| `/gate` skill | ❌ 废弃 | Skill 不能调用 Skill |
| `gate:prd`, `gate:dod` 等 | ❌ 废弃 | 伪代码，从未实现 |
| 单独的 `/qa`, `/audit` | ⚠️ 兼容 | 已合并为 `/review` |

---

## ZenithJoy Publish Engine 集成 (KR2.2)

### 概述

Cecelia Brain 负责调度 ZenithJoy Publish Engine 的发布任务。Publish Engine 作为独立服务运行在 zenithjoy-autopilot 项目中。

### 架构

```
Cecelia Brain (5221)
    │
    ▼
POST /api/publish/jobs ──► ZenithJoy Publish Engine (5300)
    │                           │
    │                           ├─ BullMQ Queue
    │                           ├─ Platform Adapters
    │                           └─ PostgreSQL State
    │
    ▼
Polling: GET /api/publish/jobs/:id
    │
    ▼
Status: success/failed ──► Update Cecelia Tasks DB
```

### 触发发布任务

**Brain → Publish Engine**:

```javascript
// Cecelia Brain 代码示例
async function triggerPublishJob(contentId, platforms) {
  const response = await axios.post('http://localhost:5300/api/publish/jobs', {
    content_id: contentId,
    platforms: platforms, // ['douyin', 'xiaohongshu', 'weibo']
    priority: 1, // 0=normal, 1=high, 2=urgent
    scheduled_at: null // null = publish immediately
  });

  return response.data.job_id; // UUID
}
```

### 查询发布状态

**Brain 轮询机制**:

```javascript
async function checkPublishStatus(jobId) {
  const response = await axios.get(`http://localhost:5300/api/publish/jobs/${jobId}`);

  return {
    job_id: response.data.id,
    status: response.data.status, // pending/running/success/failed/partial
    platforms: response.data.records.map(r => ({
      platform: r.platform,
      status: r.status,
      post_id: r.platform_post_id,
      url: r.platform_url,
      error: r.error_message
    }))
  };
}
```

### 任务闭环流程

```
1. Cecelia Brain 收到发布请求（用户或自动化）
    ↓
2. Brain 创建 task_type=publish 任务记录
    ↓
3. Brain 调用 Publish Engine API (POST /api/publish/jobs)
    ↓
4. Publish Engine 返回 job_id
    ↓
5. Brain 定时轮询状态 (GET /api/publish/jobs/:id)
    ↓
6. Publish Engine Worker 完成发布
    ↓
7. Brain 检测到 status=success → 更新 Cecelia Tasks DB
    ↓
8. Brain 通知用户（可选）
```

### 失败处理

**重试策略**：由 Publish Engine 内部处理（Retry Engine + BullMQ）
**Brain 职责**：只负责查询最终状态和记录结果

```javascript
async function handlePublishResult(taskId, jobId) {
  const status = await checkPublishStatus(jobId);

  if (status.status === 'success') {
    await updateTask(taskId, { status: 'completed', result: status });
  } else if (status.status === 'failed') {
    await updateTask(taskId, {
      status: 'failed',
      error: status.platforms.filter(p => p.status === 'failed').map(p => p.error).join(', ')
    });
  } else if (status.status === 'partial') {
    // 部分平台成功，部分失败
    await updateTask(taskId, { status: 'completed', result: status, warning: 'partial_success' });
  }
}
```

### 监控与告警

**Publish Engine 指标** (Prometheus):
- `publish_success_rate`: 发布成功率（目标 ≥ 95%）
- `publish_duration_seconds`: 发布耗时

**Brain 集成**:
- Brain 可查询 Prometheus API 获取实时成功率
- 如果成功率 < 95%，Brain 触发告警任务（通知管理员）

```javascript
async function monitorPublishHealth() {
  const successRate = await axios.get('http://localhost:9090/api/v1/query?query=publish_success_rate');

  if (successRate.data.value < 0.95) {
    await createTask({
      task_type: 'alert',
      title: '发布成功率低于 95%',
      priority: 'urgent',
      description: `当前成功率: ${successRate.data.value}`
    });
  }
}
```

### API 端点规范

| 端点 | 方法 | 请求体 | 响应 |
|------|------|--------|------|
| /api/publish/jobs | POST | `{content_id, platforms, priority?, scheduled_at?}` | `{job_id, status}` |
| /api/publish/jobs/:id | GET | - | `{id, status, platforms, records[]}` |
| /api/publish/jobs/:id/records | GET | - | `[{platform, status, post_id, url, error}]` |

### 数据库关联

**Cecelia Tasks 表**:
- `task_type = 'publish'`
- `metadata.job_id` 存储 Publish Engine 返回的 job_id
- `metadata.platforms` 存储目标平台列表

**Publish Engine 表**:
- `publish_jobs.metadata.cecelia_task_id` 可选：反向引用（用于 debug）

---

## 下一步

1. [ ] 实现 Brain 读取 REVIEW-REPORT.md 并自动创建 dev 任务
2. [ ] 完善 /talk skill 的日报模板
3. [ ] 添加 /review → dev 的闭环测试
4. [ ] 实现 Publish Engine 调度逻辑（KR2.2）
5. [ ] 添加 Publish Engine 成功率监控和告警
