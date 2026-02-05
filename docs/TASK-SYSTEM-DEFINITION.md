# Cecelia 任务系统定义

**版本**: 1.0.0
**创建时间**: 2026-02-04
**状态**: 确认

---

## 1. 层级架构

```
大 OKR (季度，总目标)
├── Repository OKR (每个仓库/业务有自己的 OKR)
│   └── SubProject (Feature / Sprint，同一层级)
│       └── Task
│
└── 其他业务 OKR (自媒体等)
    └── SubProject (Sprint)
        └── Task
```

### 层级说明

| 层级 | 说明 | 数据库 |
|------|------|--------|
| **OKR** | O=目标，KR=衡量方式，可嵌套 | `goals` 表 |
| **Project** | = Repository，代码仓库或业务线 | `projects` 表 (repo_path 有值) |
| **SubProject** | Feature 或 Sprint，同一层级 | `projects` 表 (parent_id 有值) |
| **Task** | 最小执行单元 | `tasks` 表 |

### SubProject 的两种叫法

| 场景 | 叫法 | 周期 |
|------|------|------|
| 代码项目 | **Feature** | 3-5 天 |
| 运营/自媒体 | **Sprint** | 3-5 天 |

---

## 2. OKR 嵌套

```
你的总 OKR
├── cecelia-core OKR (Repository)
│   ├── KR1: 派发成功率 > 90%
│   │   └── Feature: 实时派发
│   └── KR2: 自动完成 > 5 个/天
│       └── Feature: Daily Brief
│
└── 自媒体 OKR
    ├── KR1: 日更 10 篇
    │   └── Sprint: W6 内容计划
    └── KR2: 粉丝增长 1000
        └── Sprint: W6 涨粉计划
```

---

## 3. 对话层级

| 层级 | 你聊什么 | 频率 |
|------|----------|------|
| **OKR** | 季度方向 | 季度 |
| **KR** | 月度重点 | 月度 |
| **Project** | 仓库整体 | 偶尔 |
| **SubProject** | 具体功能/计划 | **每天** |

**最小对话粒度是 SubProject（Feature/Sprint）**，不聊 Task。

---

## 4. 任务自主级别

标记在 **Task 层**，同一个 SubProject 下的 Task 可能有不同级别。

| 级别 | 你的角色 | 适用场景 |
|------|----------|----------|
| 🔴 **Operator** | 你自己跑 | 全新探索、高风险 |
| 🟡 **Collaborator** | 你和 AI 一起 | 半新任务 |
| 🟠 **Consultant** | AI 建议，你决定 | 有方向但不确定 |
| 🔵 **Approver** | AI 做完，你批准 | 已知但重要 |
| ⚪ **Observer** | AI 自动跑 | 成熟、有 SOP |

### 核心逻辑：有没有 SOP

```
有 SOP → Observer（自动跑）
没 SOP → Operator（你先跑）→ 形成 SOP → 下次 Observer
```

---

## 5. 动态导航模式

**不提前拆 Task，边跑边生成**

```
SubProject 创建 → 只知道目标和验收条件
    ↓
执行 Task 1 → 看结果
    ↓
根据结果生成 Task 2 → 看结果
    ↓
... 循环 ...
    ↓
验收通过 → SubProject 完成
```

### Task 生成逻辑

```javascript
async function planNextTask(subproject) {
  const completedTasks = await getCompletedTasks(subproject.id);
  const lastResult = completedTasks[0]?.result_summary;

  // LLM 决定下一步
  const decision = await callLLM({
    goal: subproject.title,
    acceptance: subproject.acceptance_criteria,
    completed: completedTasks,
    lastResult: lastResult
  });

  if (decision.completed) {
    await markComplete(subproject.id);
  } else {
    await createTask(subproject.id, decision.nextTask);
  }
}
```

---

## 6. 反馈汇总

按你聊的层级汇总：

```
你: "实时派发怎么样了" (SubProject 层)

Cecelia: Feature「实时派发」进度 50%

         🔴 需要你参与:
         - Task 1: 调研方案 [Consultant]

         ⚪ 自动进行中:
         - Task 2: 改配置 [Observer] - 完成
         - Task 3: 测试 [Observer] - 进行中
```

```
你: "KR1 进度" (KR 层)

Cecelia: KR1「派发成功率 > 90%」进度 60%

         Feature 1: 实时派发 - 50%
         Feature 2: Seats 分配 - 100% ✅

         🔴 需要你参与: 1 个决策
```

---

## 7. 数据库字段

### goals 表（OKR）

```sql
id UUID PRIMARY KEY
parent_id UUID          -- 父 OKR（嵌套）
project_id UUID         -- 关联 Repository（可空）
type VARCHAR(50)        -- 'objective' | 'key_result'
title VARCHAR(255)
progress INTEGER
```

### projects 表（Repository + SubProject）

```sql
id UUID PRIMARY KEY
parent_id UUID          -- 有值 = SubProject (Feature/Sprint)
name VARCHAR(255)
repo_path VARCHAR(500)  -- 有值 = Repository
acceptance_criteria TEXT -- SubProject 的验收条件
subproject_type VARCHAR(20) -- 'feature' | 'sprint'
```

### tasks 表

```sql
id UUID PRIMARY KEY
project_id UUID         -- 所属 SubProject
goal_id UUID            -- 关联 KR
autonomy_level VARCHAR(20) DEFAULT 'observer'
result_summary TEXT     -- 执行结果（用于动态规划下一步）
sequence INTEGER        -- 执行顺序
```

---

## 8. PRD 规则

- **PRD 针对 SubProject (Feature/Sprint) 写**
- 不针对 Task
- PRD 包含：目标、验收条件、不包含具体 Task 列表
