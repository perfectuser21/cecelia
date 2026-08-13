# Sprint PRD — fix loop 反馈断链：judge FAIL 裁决注入下轮 evaluator TaskBundle

## OKR 对齐

- **对应 KR**：KR（Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环）
- **当前进度**：82%
- **本次推进预期**：+1%（消除 fix loop 空耗一轮 → 升级人审的确定性浪费）

## 背景

issue 47c4434d、run 8783807c 实证：judge 判 `evidence_insufficient` 并点名缺失证据后，fix loop 重新 spawn evaluator，但 evaluator 的 TaskBundle.inputs 里没有任何 judge 反馈字段。evaluator 盲重跑、交回同一套证据，judge 原样再 FAIL，白耗一轮后升级人审。根因：`orchestrator/dispatcher.js` 组装 evaluator bundle 的 inputs（`buildInputs`/`buildBundle`）时，不读取本 run 最近一次 `verdict:judge` 的裁决内容。本 sprint 把上轮 judge 裁决接回下轮 evaluator，形成闭环反馈。

## Golden Path（核心场景）

系统从 [judge FAIL] → 经过 [下轮 evaluator bundle 组装] → 到达 [evaluator 拿到点名证据清单]

具体：
1. 同一 run 已存在一条 `verdict:judge` 的 FAIL 裁决（failure_class=evidence_insufficient，summary 点名了缺失证据）。fix loop / rerun 触发重新派发 evaluator。
2. dispatcher 组装 role=evaluator 的 TaskBundle 时，读取本 run 最近一次 judge FAIL verdict，把 `judge_feedback` 注入 `inputs`：含上轮 judge summary（点名的缺失证据清单）、failure_class、轮次；仅注入最近一次；脱敏后按长度上限截断。
3. evaluator 打开 bundle，`inputs.judge_feedback` 可见，其提示词要求本轮**优先补齐点名的缺失证据**，而非重复上轮同一套证据。无 judge verdict（首轮）时 bundle 不含该字段，行为不变。

## 边界情况

- 首轮（本 run 无 judge verdict）→ 不注入 `judge_feedback`，evaluator 行为与现状一致。
- judge summary 超长 → 截断至长度上限，保证 bundle 不超 256KB 传输闸。
- 同 run 多条 judge verdict → 只取最近一次。
- 非 evaluator 角色（planner/proposer/generator）bundle → 不注入该字段。

## 范围限定

**在范围内**：
- `dispatcher` evaluator bundle 组装侧读取最近 judge FAIL verdict 并注入 `inputs.judge_feedback`（summary + failure_class + 轮次，脱敏+截断）。
- evaluator skill 消费侧提示词：bundle 含 `judge_feedback` 时优先补齐点名证据（skills SSOT 同步 + snapshot 按流程 sync）。
- failing test 先行、修后永久进 CI。

**不在范围内**：
- 修改 judge 裁决逻辑本身、judge 证据消费窗口（8×600）。
- 其他角色（generator/proposer）的 bundle 注入。
- fix loop 轮次上限 / 升级人审策略调整。

## 假设

- [ASSUMPTION: 本 run 的 judge 裁决可从既有 verdict 存储（attempt-store / verdict:judge 常量对应记录）按 run 检索到最近一次，无需新增持久化通道。]
- [ASSUMPTION: 任务文案的 `buildTaskBundle` 指代 dispatcher.js 现有的 `buildInputs`/`buildBundle` 组装路径，函数名以实现为准。]
- [ASSUMPTION: 长度上限取一个既能覆盖点名清单、又留足其余 inputs 余量以守住 256KB 的值（实现阶段定值，脱敏后截断）。]

## 预期受影响文件

- `packages/brain/src/orchestrator/dispatcher.js`：evaluator bundle inputs 组装处注入 `judge_feedback`。
- `packages/brain/src/orchestrator/__tests__/`（或同级 test）：新增 failing test（有/无 judge verdict 两分支 + 256KB 截断回归）。
- `packages/workflows/skills/harness-evaluator/`：消费侧提示词更新（SSOT）+ 对应 snapshot 同步。

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step/feature 均空）+ 任务显式约束优先 -->
- 传输闸: TaskBundle 注入 `judge_feedback` 后总体积不得超 256KB（HARNESS_BUNDLE_MAX_BYTES）；超长 summary 必须截断。
- 证据窗口: 沿用 judge 消费窗口前 8 条 × 600 字符约束（本 sprint 不改动，仅需注入内容在窗口内可读）。
- 脱敏: 注入前对 judge summary 脱敏。
- 版本要求: 无
- 可观测: 注入/未注入路径应可从 bundle 内容判别（judge_feedback 有无即信号）。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级（step/feature 源为空） -->
- [证据先分类] judge FAIL 先区分「证据压缩窗口截断」与「实现缺陷」；`evidence_insufficient` 时优先走 evaluator 补证轮（behavior_tests 扩容）而非改代码（来源: area）
- [证据窗口] judge 证据消费窗口为前 8 条 × 600 字符，evaluator 产 `.brain-result.json` 必须把一手证据（root-cause、Red→Green 时序、exit_code）排序进窗口前列（来源: area）
- [命令实跑] 合同里的验证命令必须实跑确认 exit code 语义（vitest 对 include 范围外路径绿态也 exit 1）（来源: area）
- [已有PR时钟] 保留 validation_clock_required 默认 fail-closed；仅 gear=hotfix 且 pr_url/pr_head_sha 与 GitHub 实时观测完全一致时可建立一次共享时钟（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path；本 line 无 done/working ability -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿留占位，最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 产出（vitest 单测 + Node 断言）。

```bash
# 占位：proposer 将填入真实脚本（local_api → vitest / node 断言）
# 期望验收点（自然语言）：
# 1. 构造「本 run 已存在 judge FAIL(evidence_insufficient) verdict」的场景，调用 evaluator bundle 组装，
#    断言产出 inputs.judge_feedback 存在且含该裁决 summary 与 failure_class（先 RED 再 GREEN）。
# 2. 构造「本 run 无 judge verdict」场景，断言 inputs 不含 judge_feedback 字段。
# 3. 构造超长 judge summary，断言注入后 bundle 字节数 ≤ 256KB 且 summary 被截断（回归）。
# 4. evaluator skill 提示词在含 judge_feedback 时输出「优先补齐点名证据」的指引（snapshot 断言）。
```

## journey_type: autonomous
## journey_type_reason: 纯 packages/brain 后端 orchestrator 逻辑（bundle 组装），无 UI、无远端 agent 协议改动，与本 initiative 历史 run 记录 journey_type=autonomous 一致。
## target_environment: local_api
## target_environment_reason: 仅 packages/brain 后端 + vitest 单测，本地 evaluator 跑 vitest/node 断言即可（localhost:5221 侧无需真机 E2E）。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
