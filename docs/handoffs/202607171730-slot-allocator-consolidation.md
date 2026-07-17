# Handoff：产能判定合并（slot-allocator 收权）— 任务 beeba317

- 日期：2026-07-17 17:30 CST（管家会话 45f2cb5d 移交）
- 决策依据：Alex 07-17 口头拍板方向（机器空转实测洞察）+ 145014a4（无等级不成验口径沿用）
- **接手须知：Brain 任务 `beeba317` 已在队列（P1）。有头接手第一步必须 `PATCH /api/brain/tasks/beeba317… {"status":"in_progress"}` 正式认领防 harness 抢跑（铁律，案底见 memory headed-dev-parallel-dispatch-incident）。**

## 一、为什么干（一句话）

任务等 CI 时容器已退、内存归零，但派发闸数的是 in_progress 任务数 → "4/4 纸面满"而机器空转；同时产能领域已攒了四套平行系统，本战 = 合并收权，不是加第五套。

## 二、考古结论（已做完，勿重复）

| 系统 | 文件 | 现状 |
|---|---|---|
| **slot-allocator（收权主体）** | `packages/brain/src/slot-allocator.js`（608 行） | 原始智能判定：evaluateMemoryHealth（区分 Brain RSS 泄漏 vs 系统水位）、背压、用户会话检测、codex 池、队列深度；dispatcher.js:289 已在调 `calculateSlotBudget()` |
| harness 任务数 cap（拆除对象） | `dispatcher.js:55-97`（MAX_CONCURRENT_HARNESS_INITIATIVES，shouldApplyHarnessCap） | 后加的粗 OOM 防线，纸面满元凶；降级为 TASK_CAP=12 纯兜底 |
| capacity-budget API | `routes/capacity-budget.js` | PR 吞吐自校准（planner 侧），保留；本战给它加 machine_vitals 段 |
| fleet-cache effectiveSlots | fleet 相关 | 跨机器维度，本战不动 |

实测数据（07-17）：relay 容器平时 300-400MB、峰值顶各自硬限（当前档 1G，两个在跑的都顶过）；OrbStack 固定 5.4G；前台 6 slot 共 1.7G；CPU 87% 空闲。

## 三、改法（五表合一，判定唯一入口 = slot-allocator）

1. slot-allocator 新增 `harnessSlotCheck()`：**活 relay 容器数**（`docker ps` 前缀 `cecelia-relay-` 计数，查询失败保守按满）≥ CONTAINER_CAP（默认 4，env 可调）→ 拒；
2. 复用 `evaluateMemoryHealth`（已有）：memory_pressure → 拒；**新增数据盘 >85% → 拒**；
3. 额度两维：codex 闸（已有，保留）；**新增 Claude 侧**（account-usage 已采集，5h 余量 <10% → 拒）；
4. `shouldApplyHarnessCap` 改为调上述，旧任务数判定降级 TASK_CAP=12 兜底；**判定唯一入口收归 slot-allocator，dispatcher 不留第二套**；
5. 体征采样（df/docker 计数）挂 scheduler-jobs 定期写缓存，判定读缓存（不在派发热路径现场跑命令）；
6. capacity-budget API 加 `machine_vitals` 段暴露同一缓存（指挥舱 80a5be84 首页可视化直接吃）；
7. 日志每轮：`slot_check containers=X vitals=ok|<超阈项> quota=ok verdict=`（静默失败绝版）。

## 四、测试铁律（血泪口径，全部有案底）

- **先写 failing test**：8 个 in_progress + 活容器 2 + 体征好 + 额度足 → 现版本拒发（failing）→ 合并后放行；
- 回归：活容器 4 → 拒；memory_pressure → 拒；盘 >85% → 拒；docker 查询抛错 → 保守拒；
- **禁 mock 判定函数与数据源之间的边**（A4/A5/A6/金丝雀四连案底：mock 真实命令行为=必出哑火）；**容器内交付必须容器内实弹一发**（宿主验证≠容器可用已四例）；
- slot-allocator 既有测试全过；brain 版本 bump。

## 五、验收

- 生产日志出现 slot_check 全维原文；
- 复现今天场景：多任务等 CI 时新任务仍被派发（活容器 <4）；
- `curl /api/brain/capacity-budget` 返回 machine_vitals 段。

## 六、数据源

- 任务：beeba317（thin_prd 与本文一致）；memory：harness-lifecycle-gates-shipped（07-17 段）、dynamic-capacity-model、feedback_reuse_integrated_notion_db（禁平行轮子）
- 相关在飞：磁盘哨兵 ba6fe51c（资源守卫近亲，注意别重复实现 df 采样——共用 scheduler 缓存）
