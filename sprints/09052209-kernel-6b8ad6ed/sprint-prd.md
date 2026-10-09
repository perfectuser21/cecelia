# Sprint PRD — Crystal 第4件:结晶判官（结晶台账 + 晋升/降级判决 + 每日结晶报告）

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：+2%（为技能蒸馏闭环补齐"判官"环节，让固化/回退有数据依据）

## 背景

决策 28ca1f69（技能蒸馏五步循环）定下了固化判据 = 频率 × 失败率、探针强制、判定层不蒸馏。
本 sprint 交付执行这套判据的"结晶判官"：把纯 LLM 与固化件的运行数据结晶成台账，按规则出具三态判决，
每日产出建议清单交人拍板。第一批被告 = OpenClaw leadgen 八格。

## Golden Path（核心场景）

系统从 [每日定时触发判官] → 经过 [聚合台账 → 出具判决 → 生成报告] → 到达 [人查看每日结晶报告并对建议拍板]

具体：
1. Brain 定时任务触发结晶判官，对 OpenClaw leadgen 八格逐格/逐技能拉取数据源
   （n8n execution_entity + HK 裁决流水采集器（已有 108 条）+ postcondition 结果）
2. 判官聚合每格/技能六项指标写入结晶台账：N 次 / 成功率 / token 成本 / 时延 / 新分支率 / broken_count
3. 判决引擎对每格套三态规则出具判决并记录触发依据：
   - 保持纯 LLM：跑得好且低频，或变体未收敛（新分支率高）
   - 晋升（固化）：N≥20 ∧ 成功率≥90% ∧ 零新分支 ∧ 频率×token成本 > 固化成本
   - 降级：固化件 N 天内碎 K 次（broken_count 超阈）
4. 生成每日结晶报告（建议晋升/降级/保持 + 依据指标）落库，可经 Brain API 查询
5. 配套：证据留存规范（截图/轨迹文件名强制带 trial+timestamp，禁复用覆盖）；
   registry 回写（视觉定位成功 → 自动写回 registry，key=model|app_version|density）

出口：人（管家）curl 到当日结晶报告，看到八格各自判决与依据，对晋升/降级建议拍板（初期不自动执行）。

<!-- Response Schema 由 Proposer 在 Step 1.1 读 api_registry 后推导，Planner 不定义技术规范。 -->

## 边界情况

- 数据不足（N<20）：判"保持纯 LLM"，证据不足不晋升
- 变体未收敛（新分支率高）：保持纯 LLM，即使成功率高也不晋升
- 数据源无新数据/采集器空：报告标注数据缺口，不误判为成功或失败
- 证据文件名重名：按①规范视为异常，禁覆盖，计入 broken/异常而非静默丢弃

## 范围限定

**在范围内**：结晶台账（六项指标聚合与落库）；三态判决规则引擎；每日结晶报告（Brain job + 查询端点）；
证据留存规范（trial+timestamp 文件名、禁覆盖）；registry 回写（定位成功自动写回）；第一批被告 = OpenClaw leadgen 八格。

**不在范围内**：自动执行晋升/降级（初期一律人拍板）；判定层蒸馏（决策 28ca1f69：判定层永不固化）；
非 OpenClaw 格子；蒸馏喂食本身（属第81批常驻监工唤醒器）。

## 假设

- [ASSUMPTION: 三个数据源（n8n execution_entity / HK 裁决流水采集器 / postcondition 结果）均已可读，判官只读不改原始数据]
- [ASSUMPTION: 与第81批常驻监工唤醒器无台账重复；proposer 开工前先查该批产物，若已有喂食台账则复用其表而非另建]
- [ASSUMPTION: 晋升公式中"固化成本"基线 payload 未给定，先以常量占位，具体值由 proposer/决策补齐]
- [ASSUMPTION: 降级阈值 N 天 / K 次 payload 未给定，取保守默认（如 7 天碎 3 次），proposer 阶段确认]

## 预期受影响文件

- `packages/brain/src/`：结晶判官定时任务、结晶台账 schema/聚合、三态判决规则、每日报告查询端点
- registry 回写与证据留存规范落点由 proposer 在 Step 1.1 读 api_registry 后精确定位

## NFR 约束

<!-- 来源: decisions（step/feature NFR 均空）+ 决策 28ca1f69，PrepPRD 显式值优先 -->
- 数据完整性：判官只读数据源，不得改写 n8n/采集器原始数据
- 可入库门槛：无 postcondition 的技能不许入库判决（决策 28ca1f69）
- 可观测：数据缺口/判决失败必须写 Brain log
- 超时/频控：待定（PrepPRD 未指定）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: 决策 28ca1f69（architecture）+ area 级 invariant，去重合并 -->
- [判定层不蒸馏] 判定层（干成了没有）永不固化为硬编码；事实观测不到就永远走视觉/LLM（来源: 决策 28ca1f69）
- [探针强制] 固化时强制配探针，无 postcondition 不许入库；探针失败超阈自动退回 LLM 重标定（来源: 决策 28ca1f69）
- [registry是数据] 技能体内禁出现坐标；序列固化进代码，定位存 registry（key=model|app_version|density），schema 走 CI、值由运行时探针守护、禁走 PR（来源: 决策 28ca1f69）
- [证据留痕] 截图/轨迹文件名必须带 trial+timestamp，禁复用文件名覆盖（来源: 决策 28ca1f69）
- [固化优先级] 固化优先级 = 频率 × 失败率，先固化 LLM 最易点飞的片段（来源: 决策 28ca1f69）
- [DIRTY路由] PR 与 main 冲突（DIRTY）必须路由 generator-fix 做 rebase，禁死等/判死（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path；journey golden-paths 返回空 -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿留占位，最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（curl + psql）。

```bash
# 占位：proposer 将填入真实 local_api 脚本（curl localhost:5221 + psql cecelia）
# 期望验收点（自然语言）：
#  1. 触发结晶判官后，psql 查结晶台账表，OpenClaw leadgen 八格各有 1 行、含六项指标（N/成功率/token/时延/新分支率/broken_count）
#  2. 每格有且仅有 1 条三态判决（保持纯LLM/晋升/降级）且带触发依据字段
#  3. curl Brain API 拿到当日每日结晶报告，列出八格建议清单（建议晋升/降级/保持 + 依据）
#  4. N<20 的格子判决必为"保持纯LLM"（数据不足不晋升）
```

## journey_type: autonomous
## journey_type_reason: 仅涉及 packages/brain/ 纯后端（定时任务/台账/判决/报告），无 UI 无远端 agent 协议
## target_environment: local_api
## target_environment_reason: Brain 内部后台任务，E2E 走本地 curl localhost:5221 + psql cecelia 验证台账与报告
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
