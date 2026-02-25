# Dispatch Rules（调度规则）

## 双模式路由 (v3.0)

### 执行模式

| 模式 | 名称 | 特点 | 适用场景 |
|------|------|------|----------|
| **Agent Chain** | 即时执行 | 同步、交互、低延迟 | 简单任务、需要反馈 |
| **Task Queue** | 队列执行 | 异步、持久、可恢复 | 复杂任务、批量、过夜 |

### Cecelia 路由决策

```
用户输入
    │
    ▼
路由分类器（Cecelia）
    │
    ├── NOW（现在/立刻/马上）
    │   └── Agent Chain → Autumnrice 同步执行
    │
    ├── TONIGHT（今晚跑/明早给我/批量）
    │   └── Task Queue → 创建 TRD → /tick 推进
    │
    └── MIXED（先计划/确认后执行）
        └── Chain 生成方案 → 用户确认 → Queue 执行
```

### 默认规则

**默认走 Task Queue**，只有满足以下条件才走 Agent Chain：
- 明确的即时触发词（现在、立刻、马上）
- 低风险任务（查询、简单爬取）
- 需要交互反馈

### 模式传递

```
Cecelia → Autumnrice → 执行者
  │           │
  mode        mode
  chain       chain → 同步调用
  queue       queue → 异步调用 + 更新 DB
```

---

## 职责边界

### Autumnrice（管任务树）

- 决定"做什么"
- 拆解成可执行单元
- 决定"交给谁"
- 不关心"怎么跑"

### Nobel（管运行时）

- 决定"怎么跑"
- 编排 N8N workflow
- 决定"带什么参数"
- 写回执

**一句话**：Autumnrice 管任务树，Nobel 管运行时。

## Autumnrice 调度规则

### 任务类型判断

```
收到 Request
    │
    ▼
分析任务类型
    │
    ├── 编程类 → Caramel
    │   - 关键词: 写代码、改 bug、加功能、重构、测试
    │   - 产出: PR、代码文件
    │
    ├── 自动化类 → Nobel
    │   - 关键词: 爬取、发布、同步、备份、通知
    │   - 产出: 数据、状态变更
    │
    ├── 质量类 → 小检/小审
    │   - 关键词: 检查、审核、验证
    │   - 产出: 通过/打回
    │
    └── 混合类 → 拆分
        - 先编程，再自动化
        - 用任务依赖表达顺序
```

### 任务拆分原则

1. **单一职责**：一个 Task 只做一件事
2. **可验收**：每个 Task 有明确的 DoD
3. **可并行**：无依赖的 Task 可以并行
4. **可回滚**：每个 Task 失败不影响其他

### 示例拆分

```
用户: "写一个登录页面并发布到测试环境"

拆分:
├── task-1: 写登录页面代码 (Caramel)
│   └── DoD: PR 创建，CI 通过
├── task-2: Code Review (小检)
│   └── DoD: 代码质量通过
│   └── depends_on: task-1
├── task-3: 安全审计 (小审)
│   └── DoD: 无安全问题
│   └── depends_on: task-1
├── task-4: 合并 PR (Caramel)
│   └── DoD: PR 合并到 main
│   └── depends_on: task-2, task-3
└── task-5: 部署到测试环境 (Nobel → 小维)
    └── DoD: 测试环境可访问
    └── depends_on: task-4
```

## Nobel 调度规则

### 员工匹配

```javascript
function matchWorker(task) {
  const keywords = task.goal.toLowerCase();

  // 按优先级匹配
  if (match(keywords, ['爬取', '采集', '抖音', '小红书', '微博', '知乎', '快手', '头条', '视频号', '公众号'])) {
    return '小析';
  }
  if (match(keywords, ['发布', '登录', 'VNC', '运营'])) {
    return '小运';
  }
  if (match(keywords, ['备份', '监控', '定时', '清理', '维护'])) {
    return '小维';
  }
  if (match(keywords, ['同步', 'Notion', 'Webhook', '飞书'])) {
    return '小通';
  }

  return null; // 无法匹配，上报 Autumnrice
}
```

### Workflow 参数构造

执行层员工只接收**结构化输入**，不接收自然语言。

```javascript
// 小析（数据采集）标准输入
{
  "platform": "xiaohongshu",  // 平台
  "action": "scrape_hot",     // 动作
  "count": 50,                // 数量
  "category": "fashion",      // 分类
  "output_format": "json"     // 输出格式
}

// 小运（内容发布）标准输入
{
  "platform": "toutiao",      // 平台
  "content_type": "article",  // 类型
  "title": "...",             // 标题
  "body": "...",              // 正文
  "assets": ["url1", "url2"], // 素材
  "schedule_time": null       // 定时（null=立即）
}

// 小维（运维）标准输入
{
  "action": "backup",         // 动作
  "target": "database",       // 目标
  "retention_days": 7         // 保留天数
}

// 小通（集成）标准输入
{
  "action": "sync",           // 动作
  "source": "core_db",        // 来源
  "target": "notion",         // 目标
  "table": "tasks"            // 表
}
```

### 回执要求

每个执行完成后必须回写：

```json
{
  "task_id": "task-a1b2c3d4",
  "status": "success",
  "evidence": {
    "json_output": {...},
    "log_file": "/tmp/task-a1b2c3d4.log",
    "duration_ms": 12345
  },
  "completed_at": "2026-01-30T10:00:00Z"
}
```
