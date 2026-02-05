# Cecelia 智能调度系统设计

## 核心问题

当前系统：
- 只看一个 Objective
- 单队列 FIFO
- 没有 task_type 区分
- 没有 deadline 考虑

需要：
- 跨 OKR 调度
- 多队列/配额
- 智能优先级
- 依赖关系

---

## 一、Task Type 优先级设计

### 默认优先级权重

| task_type | 基础权重 | 理由 |
|-----------|---------|------|
| **review** | 100 | 质量门控，阻塞下游 |
| **dev** | 80 | 主要产出工作 |
| **automation** | 60 | 辅助工作 |
| **talk** | 40 | 日报/总结，通常定时 |
| **research** | 20 | 调研，不紧急 |

### 为什么 review 最高？

```
Review 发现问题 → 产生 dev 任务 → dev 修复
如果 review 卡住，问题堆积，越晚发现越难修

正确顺序：
1. Review 先行（发现问题）
2. Dev 跟进（修复问题）
3. Talk 收尾（总结日报）
```

---

## 二、多队列配额设计

### 席位分配

总席位: 6
- 预留手动: 1
- 自动调度: 5

```
┌─────────────────────────────────────────────┐
│  Slot 配额分配                               │
│                                             │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐   │
│  │ Dev │ │ Dev │ │ Dev │ │Review│ │ Any │   │
│  │  1  │ │  2  │ │  3  │ │      │ │     │   │
│  └─────┘ └─────┘ └─────┘ └─────┘ └─────┘   │
│                                             │
│  dev: 最多 3 个并发                          │
│  review: 保证 1 个席位                       │
│  any: 灵活分配（talk/automation/research）  │
└─────────────────────────────────────────────┘
```

### 配额规则

```javascript
const SLOT_QUOTAS = {
  dev: { min: 0, max: 3 },       // 开发最多3个
  review: { min: 1, max: 2 },    // 审查保证1个
  talk: { min: 0, max: 1 },      // 日报最多1个
  automation: { min: 0, max: 1 }, // 自动化最多1个
  research: { min: 0, max: 1 }   // 调研最多1个
};
```

---

## 三、智能评分公式

### 任务得分计算

```javascript
function calculateTaskScore(task) {
  let score = 0;

  // 1. 基础权重（task_type）
  const typeWeight = {
    review: 100,
    dev: 80,
    automation: 60,
    talk: 40,
    research: 20
  };
  score += typeWeight[task.task_type] || 50;

  // 2. 优先级加成
  const priorityBonus = {
    P0: 200,  // P0 直接置顶
    P1: 50,
    P2: 10
  };
  score += priorityBonus[task.priority] || 0;

  // 3. Deadline 紧迫度
  if (task.due_date) {
    const hoursLeft = (new Date(task.due_date) - Date.now()) / (1000 * 60 * 60);
    if (hoursLeft < 0) {
      score += 300;  // 已过期，最高优先
    } else if (hoursLeft < 4) {
      score += 150;  // 4小时内
    } else if (hoursLeft < 24) {
      score += 80;   // 24小时内
    } else if (hoursLeft < 72) {
      score += 30;   // 3天内
    }
  }

  // 4. 等待时间加成（防饥饿）
  const waitingHours = (Date.now() - new Date(task.created_at)) / (1000 * 60 * 60);
  score += Math.min(waitingHours * 2, 50);  // 最多+50

  // 5. 被阻塞任务数（如果很多任务等这个完成）
  const blockingCount = task.blocking_count || 0;
  score += blockingCount * 30;

  // 6. OKR 权重
  const okrWeight = task.okr_weight || 1;
  score *= okrWeight;

  return score;
}
```

### 评分示例

| 任务 | type | priority | deadline | 等待 | 阻塞数 | 得分 |
|------|------|----------|----------|------|--------|------|
| PR Review | review | P1 | 2h后 | 1h | 3 | 100+50+150+2+90 = 392 |
| 写功能 A | dev | P0 | - | 4h | 0 | 80+200+0+8+0 = 288 |
| 写日报 | talk | P2 | 今晚 | 0h | 0 | 40+10+80+0+0 = 130 |
| 调研 X | research | P2 | - | 48h | 0 | 20+10+0+50+0 = 80 |

---

## 四、依赖关系处理

### 数据结构

```sql
-- tasks.payload 中存储依赖
{
  "depends_on": ["task-id-1", "task-id-2"],  -- 前置任务
  "blocks": ["task-id-3", "task-id-4"]       -- 被此任务阻塞的任务
}
```

### 依赖类型

| 类型 | 示例 | 处理方式 |
|------|------|----------|
| **硬依赖** | dev B 必须等 dev A 完成 | A 完成前 B 不能派发 |
| **软依赖** | review 最好在 dev 之后 | 优先级降低，但可以提前做 |
| **触发依赖** | review 完成后自动创建 dev | 回调时创建新任务 |

### 依赖检查

```javascript
async function canDispatch(task) {
  const dependsOn = task.payload?.depends_on || [];

  if (dependsOn.length === 0) return true;

  const result = await pool.query(
    "SELECT COUNT(*) FROM tasks WHERE id = ANY($1) AND status != 'completed'",
    [dependsOn]
  );

  return parseInt(result.rows[0].count) === 0;
}
```

---

## 五、跨 OKR 调度

### 不再只看一个 Objective

```javascript
async function selectTasksToDispatch(availableSlots) {
  // 1. 获取所有活跃的 Objectives（不只是焦点）
  const objectives = await pool.query(`
    SELECT id, priority, progress,
           (metadata->>'weight')::float as weight
    FROM goals
    WHERE type = 'objective'
      AND status IN ('in_progress', 'pending')
  `);

  // 2. 计算每个 Objective 的配额
  const totalWeight = objectives.rows.reduce((sum, o) => sum + (o.weight || 1), 0);
  const objectiveQuotas = objectives.rows.map(o => ({
    id: o.id,
    quota: Math.ceil(availableSlots * (o.weight || 1) / totalWeight)
  }));

  // 3. 从各 Objective 选择任务，按得分排序
  const allTasks = [];
  for (const obj of objectiveQuotas) {
    const tasks = await getTasksForObjective(obj.id, obj.quota);
    allTasks.push(...tasks);
  }

  // 4. 全局排序
  allTasks.sort((a, b) => b.score - a.score);

  // 5. 按配额分配
  return allocateByQuota(allTasks, availableSlots);
}
```

### Objective 权重

| Objective | Priority | Weight | 说明 |
|-----------|----------|--------|------|
| Cecelia 架构升级 | P0 | 3 | 主要项目 |
| 质量监控 v2 | P1 | 2 | 重要项目 |
| 文档整理 | P2 | 1 | 次要项目 |

5 个 slot 分配：
- Cecelia: 3/6 * 5 ≈ 2.5 → 3 个
- 质量监控: 2/6 * 5 ≈ 1.7 → 2 个
- 文档: 1/6 * 5 ≈ 0.8 → 0 个（最低保证可选）

---

## 六、定时任务

### Talk (日报) 特殊处理

```javascript
// 每天 21:00-22:00 自动提升 talk 任务优先级
function getTalkBoost() {
  const hour = new Date().getHours();
  if (hour >= 21 && hour < 22) {
    return 200;  // 晚上 9 点，日报优先
  }
  return 0;
}
```

### Automation 触发

```javascript
// 某些 automation 任务在特定时间触发
const SCHEDULED_AUTOMATIONS = {
  'daily-backup': { hour: 3, minute: 0 },
  'weekly-report': { dayOfWeek: 0, hour: 20 }
};
```

---

## 七、实现路线

### Phase 1: 基础多队列
1. [ ] 添加 SLOT_QUOTAS 配置
2. [ ] 修改 dispatchNextTask() 检查配额
3. [ ] 添加 task_type 基础权重

### Phase 2: 智能评分
4. [ ] 实现 calculateTaskScore()
5. [ ] 添加 due_date 字段到 tasks 表
6. [ ] 添加 blocking_count 计算

### Phase 3: 跨 OKR
7. [ ] 修改 selectTasksToDispatch() 不限于焦点
8. [ ] 添加 Objective weight 字段
9. [ ] 实现按权重分配

### Phase 4: 定时任务
10. [ ] Talk 定时优先级提升
11. [ ] Automation 定时触发

---

## 八、配置项

```javascript
// brain/src/scheduler-config.js

export const SCHEDULER_CONFIG = {
  // 席位配额
  slots: {
    total: 6,
    reserved: 1,
    quotas: {
      dev: { min: 0, max: 3 },
      review: { min: 1, max: 2 },
      talk: { min: 0, max: 1 },
      automation: { min: 0, max: 1 },
      research: { min: 0, max: 1 }
    }
  },

  // 类型权重
  typeWeights: {
    review: 100,
    dev: 80,
    automation: 60,
    talk: 40,
    research: 20
  },

  // 优先级加成
  priorityBonus: {
    P0: 200,
    P1: 50,
    P2: 10
  },

  // Deadline 加成
  deadlineBonus: {
    expired: 300,
    within4h: 150,
    within24h: 80,
    within72h: 30
  },

  // 等待时间加成（每小时）
  waitingBonus: {
    perHour: 2,
    max: 50
  },

  // 定时任务
  scheduled: {
    talkBoostHour: 21,  // 晚上9点提升日报优先级
    talkBoostAmount: 200
  }
};
```

---

## 九、调度流程图

```
每 5 秒 Tick
    │
    ▼
检查可用席位
    │
    ▼
┌───────────────────────────────────────┐
│  各类型当前占用 vs 配额                 │
│                                       │
│  dev: 2/3 ✓                           │
│  review: 0/2 → 需要补充！              │
│  talk: 0/1 ✓                          │
│  automation: 1/1 ✓                    │
│  research: 0/1 ✓                      │
└───────────────────────────────────────┘
    │
    ▼
按需选择任务类型（review 优先）
    │
    ▼
┌───────────────────────────────────────┐
│  从所有 Objectives 收集 review 任务    │
│                                       │
│  1. PR Review for Feature A (得分 392)│
│  2. Code Audit for Bug Fix (得分 280) │
│  3. ...                               │
└───────────────────────────────────────┘
    │
    ▼
检查依赖 → 派发得分最高的
    │
    ▼
更新状态，记录日志
```
