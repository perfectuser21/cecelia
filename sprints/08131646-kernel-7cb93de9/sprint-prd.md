# Sprint PRD — fix loop 反馈断链：judge FAIL 裁决注入下轮 evaluator TaskBundle

## OKR 对齐

- **对应 KR**：KR「Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环」（当前 82%）
- **当前进度**：82%
- **本次推进预期**：+1%（消除 fix loop 空转一轮 → 升人审的浪费路径）

## 背景

issue 47c4434d / run 8783807c 实证：judge 判 `evidence_insufficient` 并点名缺失证据后，fix loop 重新 spawn evaluator，但其 TaskBundle.inputs 不含任何 judge 反馈字段。evaluator 盲重跑交同一套证据，judge 原样再 FAIL，白耗一轮后升级人审。

根因锚定：`packages/brain/src/orchestrator/dispatcher.js` 的 `buildInputs`（buildTaskBundle 调用链）在组装 evaluator bundle（`spec.role === 'evaluator'` 分支，当前 dispatcher.js:428）时，不读取本 run 最近一次 `verdict:judge` 的裁决内容。对照现状：generator-fix 分支已有 `evaluator_feedback` 注入先例（dispatcher.js:422），evaluator 分支缺对称的 `judge_feedback`。`verdict:judge` 可循 `latestContextAnswer` 从 `observed.decisionLog` 过滤读取的既有模式（dispatcher.js:293）取回。

## Golden Path（核心场景）

系统从 [judge 判 FAIL] → 经过 [fix loop 重派 evaluator，dispatcher 注入上轮 judge 裁决] → 到达 [evaluator 收到点名缺失证据、优先补齐]

具体：
1. 同一 run 已存在至少一条 `verdict:judge` 且判 FAIL（含 `evidence_insufficient`），fix loop 触发重新 spawn evaluator。
2. dispatcher `buildInputs`（role=evaluator）从 `observed` 读取本 run **最近一次** judge FAIL 裁决，脱敏并按上限截断后，写入 `inputs.judge_feedback`（含 judge summary 含点名缺失证据清单、failure_class、轮次）。
3. evaluator skill 消费侧收到 `judge_feedback` 时，提示词要求**优先补齐 judge 点名的缺失证据**，而非盲目重跑同一套证据。
4. 无任何 judge verdict（首轮 evaluator）时，`inputs.judge_feedback` 字段不注入（对齐现有 `human_context`/`thin_prd` 的「有值才注入」纪律）。

<!-- Response Schema由Proposer在Step 1.1读api_registry后推导，Planner不负责定义技术规范。 -->

## 边界情况

- 同 run 多条 judge FAIL verdict → 只注入最近一次（按 hop 排序取最新，同 `latestContextAnswer` 语义）。
- judge summary 超长 → 脱敏后按固定上限截断，保证注入后 bundle 不越 256KB 传输闸。
- judge 判 PASS 或不存在 judge verdict → 不注入 `judge_feedback`。
- judge FAIL 但 failure_class 非 evidence 类 → 仍注入（消费侧自行区分证据截断 vs 实现缺陷，见 Invariant）。

## 范围限定

**在范围内**：
- `buildInputs` role=evaluator 分支新增 `judge_feedback` 注入（读最近 judge FAIL verdict + 脱敏 + 截断）。
- failing test 先行：验证注入/不注入两态 + 256KB 传输闸回归。
- evaluator skill SSOT 提示词消费侧同步（优先补齐点名证据），snapshot 按流程 sync。

**不在范围内**：
- generator-fix 侧 `evaluator_feedback`（已存在，不动）。
- judge/evaluator 证据消费窗口本身（前 8 条 × 600 字符）的改动。
- 人审升级逻辑、验证时钟、PR 合并时序。

## 假设

- [ASSUMPTION: 本 run 的 judge 裁决可从 `observed.decisionLog` 以 `action === 'verdict:judge'` 过滤取得，字段含 summary/failure_class/hop；若实际字段名不同，proposer 在 Step 1.1 核对 ground-truth 后校准。]
- [ASSUMPTION: `judge_feedback` 截断上限取一个明确常量（如 8KB），保证叠加后 bundle < 256KB；具体数值 proposer 阶段与 256KB 闸联合定。]

## 预期受影响文件

- `packages/brain/src/orchestrator/dispatcher.js`：`buildInputs` role=evaluator 分支新增 `judge_feedback` 读取+脱敏+截断+注入。
- `packages/brain/**/*.test.*`（dispatcher/buildTaskBundle 对应测试）：新增 failing test（注入/不注入两态 + 256KB 回归），永久进 CI。
- evaluator skill SSOT（`packages/workflows/` 下 harness-evaluator skill 真身）+ 对应 snapshot：消费侧提示词同步。

## NFR 约束

<!-- 来源: decisions 表 category=nfr（journey/task 均空）；256KB 闸来自 dispatcher.js 既有代码注释 -->
- 传输上限: TaskBundle ≤ 256KB（`judge_feedback` 注入后不得越闸，超长 summary 必须截断）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 无
- 可观测: judge_feedback 注入应可从 evaluator TaskBundle.inputs 直接观察（单测即为 oracle）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级（本 task ability_id 为 null，无 step/feature 源） -->
- [judge-fail-triage] judge FAIL 先区分「证据压缩窗口截断」与「实现缺陷」：evidence_insufficient 时优先走 evaluator 补证据（来源: area）
- [judge-evidence-window] judge 证据消费窗口为前 8 条 × 600 字符，evaluator 产 .brain-result.json 必须把一手证据放前列（来源: area）
- [evaluator-tmp-isolation] evaluator 临时脚本必须落会话独享路径（含 session id），禁止共享 /tmp 固定文件名（来源: area）
- [validation-clock] Kernel existing PR evaluator validation clock 采纳不变量（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 journey 已完成 ability 的 golden_path；本 journey 仅有 planned 态 ability，无 done/working 历史 -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿此区块留空占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填 curl+psql/单测命令。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本（vitest 单测 + 必要时 psql 读 decision_log）
# 期望验收点（自然语言）：
# 1) 构造 run 存在一条 verdict:judge FAIL（含点名缺失证据的 summary + failure_class），
#    调 buildTaskBundle(role=evaluator) → inputs.judge_feedback 含该 summary 与 failure_class 与轮次。
# 2) 无 judge verdict 时，buildTaskBundle(role=evaluator) 产出的 inputs 无 judge_feedback 字段。
# 3) 超长 judge summary 注入后，bundle JSON 字节数 < 256KB（截断生效）。
```

## journey_type: autonomous
## journey_type_reason: 改动落在 packages/brain/（纯后端调度装配逻辑），无 UI/agent 协议/engine 触点
## target_environment: local_api
## target_environment_reason: Brain 内部 dispatcher 单测 + curl localhost:5221 / psql 验证，无远端机器
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定）
