# Handoff：五连发 dogfooding 收官 + 刀A（保底层）四小刀在飞

- 日期：2026-07-15 07:00 CST（管家会话 0abb80eb）
- 上游：handoff 202607140947-d0a668d9（刀B/C+收账权收归）、202607140644-f35db586（EVA v2）
- 决策依据：dc18d43d「无闸不成文」

## 一、五连发 dogfooding 总账（07-14 11:38 → 07-15 01:20，全部 MERGED）

| 发 | PR | 修了什么 | 零人工 |
|---|---|---|---|
| 1 | #3869 | ci-poll grep -c 双行 bug（CI 全绿死循环） | ✅ |
| 2 | #3875 | watchdog PR 反查补标题 [短号] 匹配 | ❌ CI 重跑+回队 |
| 3 | #3886 | buildCodexBridgePayload 补 callback_url（research 派发必炸） | ❌ 收账链断，人工补录 pr_url+evaluator done 事件 |
| 4 | #3904 | dispatch-fail-autoblock 坏任务自动隔离 | ❌ update-branch+回队 |
| 5 | #3908 | lint-contract-test-immutability CI 闸 | ✅ 单容器全程 |

**零人工完成率 2/5**。闸开火实录（全部硬证据在 brain 日志）：judge 机械闸拦假验收 3 次（no_behavior_tests/missing_exit_code/missing_log_tail，第 2 发被逼第 4 次 attempt 交齐材料）；finalize 拒提前收账 5 次（`申请被拒→降级中间态`）；watchdog 防重复 PR + 带凭证收口全对。

## 二、三次人工救场 = 同一个洞 = 刀A（保底层）

模式统一：**session 中途死（容器崩/早退）+ watchdog 只会防重复和干等 6h**——CI 红没人修、PR BEHIND 没人 update、收账数据断了没人补。a2953ddc 的 T1-T6（活性合同）已全部完成但只管"判活"，不管"判死后救活"。

## 三、刀A 四小刀（全挂 initiative a2953ddc，harness 零人工在飞）

| 刀 | task | 修什么 | 状态（07:00） |
|---|---|---|---|
| A1 | d3343415 | watchdog 死局解除：PR OPEN+容器亡+CI红/BEHIND → 有界重点火（controller Step0.4 已证明续跑不开重复 PR） | queued |
| A2 | 5e9c0496 | MERGED 反查提到 generator_done 短路前 + 容器内 base_repo 解析回退（映射表） | **手动 blocked**：与 A1 同改 watchdog.js 防撞车，**A1 completed 后必须 unblock**（管家监视带联动，监视死了就人工 `POST /tasks/5e9c0496…/unblock`） |
| A3 | 8e07a118 | relay-runs PATCH 接受 8 位短号解析 + 回写失败留痕 | queued |
| A4 | ba0a2bdc | autoblock 计数 SQL `parameter $2` 类型 bug（首战哑火）；测试禁 mock SQL 层 | queued |

各任务 payload.prep_prd_body 内含完整症状/根因/Golden Path/铁律，**不需要重新分析**。

## 四、堵队列 SOP（48h 内两次发作，第三次照抄）

症状：P1 任务排队 30min+ 无派发；brain 日志 `circuit_open_cecelia-run` + 某任务每 tick `triggerCeceliaRun failed`。
处置：`POST /api/brain/tasks/<坏任务>/block`（reason ≤100 字符）→ 下一 tick 恢复。已两次实证（9fbfbb63 缺 callback_url 已由 #3886 修；008c23db reason=undefined **根因未修**，A4 只修计数闸——undefined 那条派发路径是**新未立案缺口**）。

## 五、其他未了事项

- **EVA v3 重打分**：等刀A 落地后跑（口径：条文无代码闸计 0）；"连续 5 条零人工完成率"指标基线=2/5
- 熔断半开探针总撞同一坏任务（issue 6b047f55）：A4 修计数后大幅缓解，探针逻辑本身未动
- PR 夹带 scope 外文件无机械闸（第 1 发 #3869 实证）：归刀D（issue 3c541792）
- judge FAIL 后 session 直接退出烧 attempt（第 2 发实证）：衔接优化，暂不立案
- 僵尸 codex-headed-smoke 已被超时兜底自然收掉，无需处理
- Harness Pipeline 讲解图（前后对照版）：https://claude.ai/code/artifact/1a0bce5c-9b01-4a4b-8b81-a160bd72ebdd

## 六、新 session 接手动作

1. 查四刀状态：`psql -c "SELECT substring(id::text,1,8),status FROM tasks WHERE id::text LIKE 'd3343415%' OR id::text LIKE '5e9c0496%' OR id::text LIKE '8e07a118%' OR id::text LIKE 'ba0a2bdc%'"`
2. A1 completed 且 A2 仍 blocked → unblock A2
3. 遇 session 死+CI 红死局（A1 上线前）：`gh pr update-branch <PR>` + SQL 把任务打回 queued 清 claim（本 handoff 上游会话两次实证安全）
4. 四刀全 MERGED 后：跑 EVA v3 + 更新 memory harness-lifecycle-gates-shipped

## 数据源

- memory: harness-lifecycle-gates-shipped.md（已更新至五连发收官）
- brain 日志（机械闸/finalize/watchdog 开火原文）；issue 6b047f55 / 3c541792
- PR: #3869 #3875 #3886 #3904 #3908
