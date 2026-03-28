# Brain 模块详情

> 从 `packages/brain/src/` 提取的关键信息（更新于 2026-03-28）。
> 详细说明书：http://38.23.47.81:9998/knowledge/brain/

---

## 基本信息

| 项目 | 值 |
|------|----|
| 端口 | 5221 |
| 入口 | `packages/brain/src/routes.js`（路由汇聚）|
| Tick 间隔 | 每 5s 检查，每 2min 执行一次 tick |
| 数据库 | PostgreSQL，库名 `cecelia` |
| 源文件数 | ~171 个 .js 文件 |

---

## 三层大脑

| 层 | 文件 | 模型 | 职责 |
|----|------|------|------|
| L0 脑干 | `tick.js`, `planner.js`, `executor.js` | 纯代码 | 调度、派发、保护 |
| L1 丘脑 | `thalamus.js` | MiniMax M2.1 | 事件路由、快速判断 |
| L2 皮层 | `cortex.js` | Opus | 深度分析、RCA、战略调整 |

---

## 自驱系统（2026-03 新增）

Cecelia 的"自我感知 → 自我行动"闭环，由四个模块协作：

| 模块 | 文件 | 职责 |
|------|------|------|
| 能力探针 | `capability-probe.js` | 每小时验证所有关键链路是否通（类比感知手脚能不能动） |
| 能力扫描 | `capability-scanner.js` | 扫描系统能力使用情况（哪些能力被用了/闲置了） |
| 自驱引擎 | `self-drive.js` | 分析探针报告，自主创建修复/优化任务（4h 周期，最多 3 个任务/次） |
| 多巴胺回路 | `dopamine.js` | 记录奖赏信号，强化成功 pattern，影响自驱任务倾向 |

闭环流程：
```
Probe（链路通不通）+ Scanner（能力用没用）
  ↓
Self-Drive（分析 → 优先级排序 → 创建任务）
  ↓
Tick Loop（派发 → /dev 执行 → CI 验证）
  ↓
下次 Probe/Scan 验证效果
```

---

## 调度与保护系统

| 机制 | 文件 | 触发条件 |
|------|------|---------|
| 熔断器 | `circuit-breaker.js` | 连续失败超阈值，暂停派发 |
| 隔离区 | `quarantine.js` | 任务反复失败，移入隔离 |
| 看门狗 | `watchdog.js` | RSS/CPU 超限，告警 |
| 警觉系统 | `alertness/` | 0(平静)→4(紧急)，4级警觉 |
| Area 调度 | `area-scheduler.js` | YARN Fair Scheduler 模型：min/max/weight 三参数，按业务线公平分配 slot |
| Pipeline 巡航 | `pipeline-patrol.js` | 扫描所有 .dev-mode 文件，检测卡住的 /dev 会话，自动创建 pipeline_rescue 任务 |
| 免疫系统 | `immune-system.js` | 失败签名分析、自动修复路径 |

---

## 记忆系统

| 类型 | 存储 | 说明 |
|------|------|------|
| 语义记忆 | PostgreSQL + pgvector | tasks/learnings 向量搜索 |
| 事件记忆 | `cecelia_events` 表 | 时间线事件 |
| 自我模型 | `memory_stream` 表 | 自我叙事，随反刍演化 |
| 工作记忆 | `working_memory` 表 | 当前 tick 的临时状态 |

---

## 关键 API 端点

```
GET  /api/brain/health              健康检查
GET  /api/brain/status              系统状态摘要
GET  /api/brain/status/full         完整系统状态（含 working_memory）
GET  /api/brain/alertness           警觉等级（0-4）
POST /api/brain/tick                手动触发 tick
GET  /api/brain/tasks               查询任务（?status=queued/in_progress 等）
POST /api/brain/tasks               创建任务
PATCH /api/brain/tasks/:id          更新任务状态/结果
GET  /api/brain/tasks/:id/logs      任务日志
GET  /api/brain/quarantine          隔离区任务
GET  /api/brain/watchdog            实时 RSS/CPU
POST /api/brain/execution-callback  任务完成回调（CI/PR 回写）
GET  /api/brain/focus               今日焦点
POST /api/brain/intent/parse        意图识别
GET  /api/brain/decisions           有效决策（SSOT）
GET  /api/brain/briefing            每日简报
GET  /api/brain/context             全景摘要（OKR+PR+任务+决策）
POST /api/brain/memory/search       语义搜索知识库
GET  /api/brain/dev-records         最近 PR 记录
GET  /api/brain/policies            免疫系统策略
GET  /api/brain/immune/dashboard    免疫系统仪表盘
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

## 集成测试模块（2026-03-28 新增）

| 文件 | 职责 |
|------|------|
| `__tests__/integration/brain-endpoint-contracts.test.js` | Brain API 端点契约测试（mock DB，supertest），覆盖 GET/POST/PATCH /tasks，无需真实 DB 或 Brain 服务 |

测试模式：`vi.mock('../../db.js')` + supertest + makeApp() 工厂函数，可在 CI ubuntu-latest 离线运行。

---

## 深度说明书

- 规划器：http://38.23.47.81:9998/knowledge/brain/planner.html
- 打分机制：http://38.23.47.81:9998/knowledge/brain/planner-scoring.html
- 完整 Brain 模块图：http://38.23.47.81:9998/knowledge/brain/
