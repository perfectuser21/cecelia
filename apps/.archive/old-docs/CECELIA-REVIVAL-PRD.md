---
id: cecelia-revival-prd
version: 1.0.0
created: 2026-01-31
updated: 2026-01-31
changelog:
  - 1.0.0: 初始版本 — Cecelia 自我复活计划
---

# Cecelia 自我复活 PRD

## 一句话目标

让 Cecelia 静默层 24/7 稳定自驱运行，能自动调度 subagent 干活、自动免疫异常、自动汇报结果。

## 背景

Cecelia 本体代码已基本完整（brain/ 217 个测试全过），但存在以下问题：
- tick 循环在跑，但 enabled=false，没有真正自驱
- 最大并发限制为 1（代码里写死），实际 cecelia-run 支持 8 slot
- 决策引擎空转（阈值太高，生成 0 个 action）
- planner V1 只能选现有任务，不能自己生成
- 没有熔断器（连续失败不会停）
- 没有通知（干完了/出问题了你不知道）
- patrol 巡逻有代码但没自动跑

## V8 架构定义

```
Cecelia = 静默层（Core）+ 人格层（Chat）

静默层（不需要 LLM，24/7 运行）：
  1. EventBus     — 统一信号入口 + 事件记录
  2. State Store  — 唯一真相（PostgreSQL）
  3. Scheduler    — 调度 + 并发管理（8 slot）
  4. Watchdog     — 卡死/超时检测
  5. Circuit Breaker — 连续失败熔断
  6. Recovery     — 自愈（retry / fallback / DLQ replay）
  7. Notifier     — 飞书推送（日报 + 异常 + 完成通知）

人格层（需要 LLM，按需唤醒）：
  1. Ear    — 意图识别（intent.js ✅ 已有）
  2. Brain  — 任务拆解（decomposer.js + planner.js ⚠️ 需升级）
  3. Mouth  — 汇报（OpenAI Realtime ⏸️ 已有代码）
  4. Memory — 经验学习（decision_log ✅ 已有）
```

## 任务拆解（按依赖顺序）

### Phase 1: 基础修通（让 Cecelia 能动）

#### Task 1.1: 修复 Scheduler 并发限制
- **文件**: `apps/core/src/brain/tick.js:20`
- **现状**: `MAX_CONCURRENT_TASKS = 1`，cecelia-run 支持 8 slot
- **改动**: 改为从配置读取，默认 3（保守起步）
- **验收**: tick 能同时派出 3 个任务

#### Task 1.2: 启用 tick 并验证闭环
- **文件**: `apps/core/src/brain/tick.js`
- **现状**: enabled=false，需要手动开
- **改动**:
  1. 确认 tick enable 后完整跑通：感知 → 聚焦 → 计划 → 派发 → 回调
  2. 修复回调路径：executor.js 的 WEBHOOK_URL 指向 5679（N8N），但 callback 端点在 5212（Core）
  3. 确保任务完成后状态正确更新
- **验收**: 手动 POST /api/brain/tick 一次，能派出任务并收到回调

#### Task 1.3: 修复决策引擎阈值
- **文件**: `apps/core/src/brain/decision.js`
- **现状**: 目标落后 20% 才触发决策，结果永远 0 action
- **改动**:
  1. 降低偏差阈值到 10%
  2. 增加"每日至少生成 1 个 action"的兜底逻辑
  3. 增加对 failed 任务的自动重试决策
- **验收**: POST /api/brain/goal/compare 返回非空 recommendations

### Phase 2: 免疫系统（让 Cecelia 不会乱）

#### Task 2.1: 实现 Circuit Breaker
- **文件**: 新建 `apps/core/src/brain/circuit-breaker.js`
- **逻辑**:
  ```
  每个 worker/skill 维护一个失败计数器
  连续失败 3 次 → 该 worker 进入 OPEN 状态（停止派任务）
  OPEN 状态持续 30 分钟 → 自动进入 HALF_OPEN（试探一次）
  试探成功 → CLOSED（恢复正常）
  试探失败 → 继续 OPEN
  ```
- **存储**: working_memory 表（key: circuit_breaker_{worker_id}）
- **验收**: 连续失败 3 次后，tick 不再往该 worker 派任务

#### Task 2.2: 自动 Patrol（卡死检测 + 自愈）
- **文件**: `apps/core/src/brain/tick.js` 中增加 patrol 调用
- **现状**: cecelia-patrol CLI 存在但没自动跑
- **改动**: 每次 tick 时检查：
  1. 有没有 in_progress 超过 30 分钟的任务 → 标记 failed + 释放 slot
  2. 有没有 slot 被僵尸进程占用 → kill + 释放
  3. 记录到 EventLog
- **验收**: 故意创建一个卡死任务，30 分钟后自动被清理

#### Task 2.3: 统一 EventBus
- **文件**: 新建 `apps/core/src/brain/event-bus.js`
- **逻辑**: 所有事件统一记录到 `cecelia_events` 表
  ```sql
  CREATE TABLE cecelia_events (
    id SERIAL PRIMARY KEY,
    event_type VARCHAR(50),  -- task_dispatched, task_completed, task_failed, circuit_open, patrol_cleanup, decision_made
    source VARCHAR(50),      -- tick, callback, patrol, circuit_breaker
    payload JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
  ```
- **改动**: tick.js、executor.js、decision.js 中所有关键操作都 emit 事件
- **验收**: 查询 cecelia_events 表能看到完整的事件流

### Phase 3: 汇报系统（让你知道 Cecelia 在干嘛）

#### Task 3.1: Notifier — 飞书推送
- **文件**: 新建 `apps/core/src/brain/notifier.js`
- **渠道**: 飞书 webhook（已有 feishu helper）
- **触发**:
  1. 任务完成 → 推送"✅ {task_title} 已完成"
  2. 任务失败 → 推送"❌ {task_title} 失败：{reason}"
  3. 熔断触发 → 推送"⚠️ {worker} 被熔断，连续失败 {n} 次"
  4. 每日 22:00 → 推送日报（今日完成 N 个、失败 N 个、明日计划）
- **验收**: 完成一个任务后飞书群收到通知

#### Task 3.2: Planner V2（自己想任务）
- **文件**: `apps/core/src/brain/planner.js`
- **现状**: V1 只 SELECT 现有 queued 任务
- **改动**: 当队列为空时，根据当前 KR 的 progress 和 gap，调用 LLM 生成下一个任务
  1. 读取当前 focus 的 Objective + KR
  2. 读取已完成的任务列表
  3. 调用 LLM："基于 KR 进度，下一步应该做什么？"
  4. 生成 task record 写入数据库
  5. 下一次 tick 自动 dispatch
- **验收**: KR 队列清空后，planner 自动生成新任务

### Phase 4: 自驱运转（让 Cecelia 真正活起来）

#### Task 4.1: 开启自驱模式
- **改动**:
  1. tick enabled 设为 true
  2. 并发设为 3
  3. 确认所有免疫机制就位
  4. 观察 24 小时
- **验收**: Cecelia 独立运行 24 小时，无卡死、无资源泄漏、有任务产出

#### Task 4.2: 自我进化闭环
- **改动**: 每周日 Cecelia 读取本周 EventLog，生成一份自我诊断：
  1. 成功率、失败率、平均耗时
  2. 哪个 worker 最不稳定
  3. 哪个 KR 进度最慢
  4. 建议优化项（写入 tasks 表作为下周任务）
- **验收**: 周日生成的诊断报告包含可执行的改进任务

## 执行策略

这些 task 可以通过 Cecelia 自己的 Task Dispatch 来执行：

```
Phase 1（修通）→ 手动触发，因为 Cecelia 还不能自驱
Phase 2（免疫）→ 半自动，Phase 1 修好后 Cecelia 能派活了
Phase 3（汇报）→ 自动，此时 Cecelia 已经能自驱
Phase 4（自驱）→ 观察 + 微调
```

每个 Phase 完成后跑一次 `npx vitest run src/brain/` 确保不退化。

## 不做的事

- ❌ 不动业务代码（media/、panorama/、scraper）
- ❌ 不拆仓库
- ❌ 不重写现有能跑的模块
- ❌ 不新建 repo
- ❌ 不碰前端
- ❌ 不碰 N8N workflow 定义

## 风险

| 风险 | 应对 |
|------|------|
| 修 tick.js 导致现有 217 个测试挂 | 每个 task 完成后跑测试 |
| 并发提高后 VPS 资源不够 | 从 3 开始，监控 CPU/内存 |
| LLM 生成的任务质量差 | Planner V2 有 dry_run 模式，先验证再执行 |
| 飞书通知太多被屏蔽 | Notifier 有频率限制，同类事件合并 |
