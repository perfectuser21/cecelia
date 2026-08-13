# Sprint PRD — F1 Capability 可信认证闭环（把现有 F1 GP Contract、Kernel Evaluator Receipt 与 Mapper 状态连成可信认证闭环）

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：+2%（Mapper 对 F1 施加 fail-closed 认证闸，杜绝无合同/陈旧 receipt 的"假绿"）

## 背景

当前 Mapper 会把 Capability 投影为 green，但缺少"认证前提"闸：即使没有 Owner-signed Golden Path Contract、或 PASS receipt 不绑定当前 PR SHA / 不绑定该 GP 合同与 Impact 合同、或 Journey Step links 未绑定 Feature/Assertion，F1 仍可能显绿。本 sprint 复用现有 Mapper、Golden Path Contract、Kernel Harness、Evaluator、Judge 与 journey_assertion_receipts，把它们连成**可信认证闭环**：F1 只有在四个前提同时成立时才可投影为绿色，否则一律 fail-closed 保持非绿。**禁止新增平行认证系统**。

## Golden Path（核心场景）

用户/系统从 [准备可丢弃 fixture：F1 Capability + 其 Feature + Journey Step links + Owner-signed GP Contract] → 经过 [真实 Evaluator 对当前 PR SHA 跑断言产出绑定 GP+Impact 合同的 PASS receipts、Mapper 查询时施加 fail-closed 认证闸] → 到达 [四前提齐备时 Mapper 把 F1 投影为 green；缺任一前提则保持非绿]

具体：

1. Owner 对 F1 的 Feature 签署 Golden Path Contract → 写入 `golden_path_contract_versions`（存在 signed 版本）
2. 真实 Evaluator（kernel-v1 harness）对**当前 PR SHA** 跑断言 → 在 `journey_assertion_receipts` 写入 PASS receipts，每条 receipt 绑定 (GP contract identity + Impact contract identity)
3. 所有必要的 Journey Step links 均绑定到 Feature/Assertion；Feature 子节点全绿
4. Mapper 查询时对 F1 施加 **fail-closed 认证闸**：仅当 (a) 存在 signed GP contract、(b) 存在当前 SHA 且绑定该 GP 合同与 Impact 合同的可信 PASS receipts、(c) 所有 step links 已绑定 Feature/Assertion、(d) Feature 子节点全绿 —— 四者同时成立才投影 green
5. 缺任一前提 → F1 保持非绿（gray/unknown），即 fail-closed

<!-- Response Schema由Proposer在Step 1.1读api_registry后推导，Planner不负责定义技术规范。 -->

## 边界情况

- 无 signed GP contract → F1 非绿
- receipts 存在但 SHA 与当前 PR 不一致（陈旧）→ 非绿
- receipts 未绑定该 GP contract identity → 非绿
- receipts 未绑定 Impact contract → 非绿
- Evaluator 非真实（mock / 伪造 Generator intent / 无 validation clock）→ 非绿
- Journey Step links 未全部绑定 Feature/Assertion → 非绿
- Feature 任一子节点非绿 → 非绿

## 范围限定

**在范围内**：复用 `golden_path_contract_versions` / `journey_assertion_receipts` / Kernel Harness / Mapper；补 evaluator bundle GP identity、receipt GP identity、Mapper fail-closed 认证闸；用可丢弃 fixture 做真实 E2E。TDD：先证明"无 signed GP contract 时 F1 不得 green"（红），再补三处绑定与闸。

**不在范围内**：新增平行认证系统；改动 F1 之外的 Capability；Dashboard/UI 展示；GP 合同签署交互 UX；改动 Mapper 陈旧度/freshness 现有语义。

## 假设

- [ASSUMPTION: payload.target_environment=playground，但本 sprint 是纯 Brain 侧认证链（Mapper/Evaluator/receipts/GP 合同版本），经 curl localhost:5221 + psql 对可丢弃 fixture 验证，与 arithmetic playground server 无关；故 target_environment 锚定为 local_api，请 controller/GAN 复核]
- [ASSUMPTION: "F1" 指某具体 Capability 节点；用可丢弃 fixture Capability/Feature/Journey/Step 构造全链，验证后清理]
- [ASSUMPTION: "当前 PR SHA" = 本 attempt 的 PR branch HEAD SHA，receipt 绑定与 SHA 比对以此为准]

## 预期受影响文件

- `packages/brain/src/map/state-resolver.js`: Mapper 查询时算态，新增 F1 的 signed-GP + receipt-binding + step-link + child-green fail-closed 认证闸
- `packages/brain/src/map/radius.js`: 现有 fail-closed 门（缺 assertion 拒绿）扩展到认证前提缺失
- `packages/brain/src/lib/journey-assertion-receipt.js`: receipt 与 assertion_revision/digest + gp_contract_id/hash + 当前 SHA 的绑定校验
- `packages/brain/src/impact-contract/assertion-receipts.js`: 真实 evaluator PASS receipt 落 `journey_assertion_receipts` 时绑定 GP identity
- `packages/brain/src/golden-path-contracts.js`: 读取 signed GP contract 身份（signed 版本存在性 + identity）
- `packages/brain/src/harness-judge.js`: 真实 Evaluator / validation clock / evidence_insufficient 约束落实

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- fail-closed 默认: 缺任一认证前提一律非绿，禁止 stale-green 假绿
- 测试节奏: CI 跑最短 smoke（单 fixture happy-path + 至少 1 条 fail-closed 反例），nightly 跑完整场景（全部 fail-closed 反例）
- 可观测: Evaluator/Judge FAIL 需可区分 evidence_insufficient 与实现缺陷

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重 -->
- [validation-clock] 保留 validation_clock_required 默认 fail-closed；仅 gear=hotfix 且 payload pr_url/pr_head_sha 与 GitHub 实时观测完全一致时，首个 Evaluator intent 可建立一次共享 validation clock，缺失或不一致一律拒绝（来源: area）
- [judge-evidence] Judge FAIL 先区分「证据压缩窗口截断(evidence_insufficient)」与「实现缺陷」；evidence_insufficient 时优先走 evaluator 补证，不误判为实现失败（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿此区块留占位；最终可执行 E2E 脚本由 proposer 在 GAN 阶段按 target_environment=local_api 产出（curl localhost:5221 + psql）。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本（curl localhost:5221 + psql 对可丢弃 fixture）
# 期望验收点（自然语言）：
#   1) 构造可丢弃 fixture：F1 Capability + Feature + Journey Step links，但【不签】 GP contract →
#      查 Mapper 投影，F1 必须为非绿（fail-closed 红/gray）。
#   2) 补齐 Owner-signed GP contract + 真实 Evaluator 对当前 SHA 产出绑定 GP+Impact 合同的 PASS receipts
#      + step links 全绑定 + Feature 子节点全绿 → Mapper 投影 F1 为 green。
#   3) 逐一破坏前提（改 SHA 使 receipt 陈旧 / 去掉 GP identity 绑定 / 去掉 impact 绑定 / 断开 step link）→
#      每种破坏都令 F1 回落非绿。
#   4) 验证结束清理 fixture，不残留脏数据。
```

## journey_type: autonomous
## journey_type_reason: 全链落在 packages/brain 后端（Mapper/GP 合同/receipts/harness-judge），无 UI、无远端 agent 协议、无 engine hooks，属纯后台自主认证链
## target_environment: local_api
## target_environment_reason: 纯 Brain 侧认证链，经本地 evaluator curl localhost:5221 + psql 对可丢弃 fixture 验证（payload 声明 playground 指 arithmetic server，与本任务无关，见假设）
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定）
