# Brain 模块详情

> 从 `packages/brain/src/` 提取的关键信息。
> 详细说明书：http://38.23.47.81:9998/knowledge/brain/

---

## 基本信息

| 项目 | 值 |
|------|----|
| 端口 | 5221 |
| 入口 | `packages/brain/src/server.js` |
| Tick 间隔 | 每 5s 检查，每 2min 执行一次 tick |
| 数据库 | PostgreSQL，库名 `cecelia` |

---

## 三层大脑

| 层 | 文件 | 模型 | 职责 |
|----|------|------|------|
| L0 脑干 | `tick.js`, `planner.js`, `executor.js` | 纯代码 | 调度、派发、保护 |
| L1 丘脑 | `thalamus.js` | MiniMax M2.1 | 事件路由、快速判断 |
| L2 皮层 | `cortex.js` | Opus | 深度分析、RCA、战略调整 |

---

## 关键 API 端点

```
GET  /api/brain/health              健康检查
GET  /api/brain/status/full         完整系统状态
GET  /api/brain/alertness           警觉等级（0-4）
POST /api/brain/tick                手动触发 tick
GET  /api/brain/tasks?status=queued 查询任务队列
POST /api/brain/tasks               创建任务
GET  /api/brain/quarantine          隔离区任务
GET  /api/brain/watchdog            实时 RSS/CPU
POST /api/brain/execution-callback  任务完成回调
GET  /api/brain/focus               今日焦点
POST /api/brain/intent/parse        意图识别
```

---

## 任务评分公式（planner.js）

```
任务总分 = 阶段分 + 状态分 + 优先级分 + 学习惩罚 + 内容加分

阶段分：  dev 阶段 = +100（最高优先）
状态分：  queued = +10，in_progress = 0
优先级：  P0 = +30，P1 = +20，P2 = +10
学习惩罚：7天内同类型失败 ≥2次 = -20
内容加分：已知拆解方案的 dev 任务 = +5
```

---

## 保护系统

| 机制 | 文件 | 触发条件 |
|------|------|---------|
| 熔断器 | `circuit-breaker.js` | 连续失败超阈值，暂停派发 |
| 隔离区 | `quarantine.js` | 任务反复失败，移入隔离 |
| 看门狗 | `watchdog.js` | RSS/CPU 超限，告警 |
| 警觉系统 | `alertness/` | 0(平静)→4(紧急)，4级警觉 |

---

## 记忆系统

| 类型 | 存储 | 说明 |
|------|------|------|
| 语义记忆 | PostgreSQL + pgvector | tasks/learnings 向量搜索 |
| 事件记忆 | `cecelia_events` 表 | 时间线事件 |
| 自我模型 | `memory_stream` 表 | 自我叙事，随反刍演化 |
| 工作记忆 | `working_memory` 表 | 当前 tick 的临时状态 |

---

## 深度说明书

- 规划器：http://38.23.47.81:9998/knowledge/brain/planner.html
- 打分机制：http://38.23.47.81:9998/knowledge/brain/planner-scoring.html
- 完整 Brain 模块图：http://38.23.47.81:9998/knowledge/brain/
