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
    ├── 小审 (代码审计员)
    │   └── task_type: audit
    │   └── skill: /audit
    │   └── 权限: plan (只读，输出报告)
    │
    ├── 小检QA (质量检查员)
    │   └── task_type: qa
    │   └── skill: /qa
    │   └── 权限: plan (只读)
    │
    ├── 小研 (调研员)
    │   └── task_type: research
    │   └── skill: 无 (纯对话)
    │   └── 权限: plan (只读)
    │
    └── 数据员
        └── task_type: data
        └── skill: 无
        └── 权限: plan (HK MiniMax)
```

---

## 路由表（实际工作）

| Agent 名 | task_type | Skill | 权限模式 | 输出产物 | 闭环方式 |
|---------|-----------|-------|---------|---------|---------|
| **Caramel** | `dev` | `/dev` | bypassPermissions | PR + 代码 | PR 合并 |
| **小检** | `review` | `/review` | plan | REVIEW-REPORT.md | 报告存入 DB |
| **小话** | `talk` | `/talk` | plan | 日报/总结.md | 文档存入 DB |
| **小审** | `audit` | `/audit` | plan | AUDIT-REPORT.md | 报告存入 DB |
| **小检QA** | `qa` | `/qa` | plan | QA-DECISION.md | 决策存入 DB |
| **小研** | `research` | 无 | plan | 调研结果 | 结果存入 DB |
| **数据员** | `data` | 无 | plan | 数据处理结果 | HK MiniMax |

### 路由方向

| task_type | 路由 | 说明 |
|-----------|------|------|
| `dev`, `review`, `qa`, `audit` | US | Claude Code (Opus/Sonnet) |
| `talk`, `research`, `data` | HK | MiniMax + N8N |

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

### audit 类型 (小审)
```
Brain 派发 → 小审 执行 /audit → 输出 AUDIT-REPORT.md → 存入 DB → 完成
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
curl -X POST "http://localhost:5221/api/brain/execution-callback" \
  -H "Content-Type: application/json" \
  -d '{"task_id":"xxx","status":"completed"}'

# 失败
curl -X POST "http://localhost:5221/api/brain/execution-callback" \
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

## 有效 task_type（单一数据源：task-router.js）

```
dev, review, qa, audit, talk, research, data
```

注意：`automation` 和 `publish` 类型已废弃/不存在。
