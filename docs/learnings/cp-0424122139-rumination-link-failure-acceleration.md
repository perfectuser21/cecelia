# Learning: Rumination 链路故障修复加速 — finally 块推进 digested 状态

## 背景

Rumination 是 Cecelia 大脑 11 条链路中的一条（tick 内空闲时批量消化 learnings → 通过 NotebookLM 生成洞察）。2026-04-24 Capability Probe 发现整个链路已连续多日故障：`daily_count=0 / undigested=164 / last_run=never`，是当下唯一故障链路（1/11 直接阻断系统功能）。

前序 RCA 任务（`cp-0424085245-rumination-digest-fix` + commit `e0b04c9c2`）已经写好了正确修复，但该分支未进入 main（watchdog liveness_dead 杀掉了 RCA 任务，PR 未能创建）。本任务负责「修复验证加速」：把已有修复落地到 main。

### 根本原因

`packages/brain/src/rumination.js::digestLearnings` 中有两条路径会**跳过** learnings 状态推进（`UPDATE learnings SET digested=true`）：

1. **LLM 抛错路径**：`callLLM('rumination', prompt)` 抛出时，异常被外层 try/catch 捕获 → 整个函数跳到 `catch(err)` → `UPDATE learnings` 代码（步骤 6）永远不执行。
2. **Dedup 早退路径**：`isInsightDuplicate` 命中后 `return []`，函数直接返回，跳过步骤 6。

任何一条触发，同一批 learnings 在下一轮 tick 会再次被取出，再次触发同样的路径 → 永久积压。症状就是 `POST /rumination/force → processed:9 insights:[] undigested 仍 164`：看起来"处理了 9 条"但实际上状态毫无推进。

### 下次预防

- [ ] 任何「取一批任务 → 处理 → 标记已处理」模式，都要用 `finally` 保证状态推进
- [ ] fallback 链（NotebookLM → callLLM）中的次级 LLM 调用必须有独立 try/catch，避免污染外层控制流
- [ ] early-return（dedup/跳过/短路）必须显式声明是否需要推进状态；默认推进，除非有明确理由回退

## 修复内容

1. `packages/brain/src/rumination.js`：
   - 步骤 6「UPDATE learnings SET digested=true」 + `_dailyCount += learnings.length` 移至新的 `finally` 块
   - callLLM fallback 分支新增独立 try/catch，异常时置 `insight=''` 继续走后续流程
2. `packages/brain/src/__tests__/rumination.test.js`：新增断言「LLM 失败时仍标记 digested」

## 验证

- 本地：`rumination.test.js` 53/53 通过；全 rumination 相关 6 个 test file 91/91 通过
- 故障现象回归：LLM 抛错或 dedup 命中时，`UPDATE learnings` 仍执行 → `processed:N` 会真实推进 `undigested_count`

## 关联记录

- 失败分支：`cp-0424085245-rumination-digest-fix`（commit `e0b04c9c2` 本次 cherry-pick 自此）
- Capability Probe: 2026-04-24 08:34:24 UTC `rumination` 探针失败记录
- 连带前序修复：`cp-03251119-fix-rumination-dedup.md`（dedup 机制本身）
- 本次 PR 属于「RCA → 修复验证」环节，RCA 结论已由上游产出
