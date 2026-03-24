# Learning: 记忆系统 PR5 — Dopamine RPE（奖赏预测误差）

Branch: cp-03242254-memory-dopamine-rpe
Date: 2026-03-24

## 实现内容

为 dopamine.js 新增 RPE（Reward Prediction Error）机制：
- `computeRPE(actual, expected)` 纯函数：actual - expected，expected=null 返回 null
- `getExpectedIntensity(taskType, skill, dbPool)` 查历史同类任务均值（最近 10 条）
- `recordExpectedReward(taskId, taskType, skill, dbPool)` 任务开始时记录期望奖赏
- `recordReward` 末尾自动查询同 taskId 的 expected_reward 事件，计算 RPE，写入 rpe_signal

## 关键决策

### 可注入 dbPool 参数模式

新函数统一增加可选的 `dbPool` 参数，默认 fallback 到全局 `pool`。
好处：不需要 spyOn 模块级变量，测试传入 mockPool 即可精确控制每条 SQL 的返回值。

### recordReward 不破坏现有签名

第5参数 `dbPool` 为可选（不加默认值），调用方不传则使用 `pool || pool`（全局连接池）。
现有所有调用代码（initDopamineListeners 等）均无需修改。

## 根本原因（本次预防设计）

原 dopamine.js 只记录实际奖赏，没有期望基线，无法区分"确实做得好"与"运气好"。
RPE = actual - expected 是多巴胺神经科学的核心模型：正值强化，负值抑制。
若 recordReward 不能感知期望，Self-Drive 的任务选择就只看绝对奖赏，缺乏相对信号。

## 下次预防

- [ ] 新增奖赏相关函数时，优先考虑是否需要基线对比（而非只记录绝对值）
- [ ] dbPool 注入模式已成惯例，后续所有 brain 模块测试用此模式，避免全局 pool mock 冲突
- [ ] rpe_signal 写入为 fire-and-forget（不 await 外部调用），已在 recordReward 末尾 await，确保测试可验证
