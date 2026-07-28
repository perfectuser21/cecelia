---
id: harness-controller-skill
description: |
  Harness Controller 的统一平台合同。确定性 Kernel Run Controller 按 run_id
  推进 Golden Path；Planner、Proposer、Reviewer、Generator、Evaluator、Judge
  和 Reporter 都是受 TaskBundle/Result Receipt 约束的角色 Attempt。本文不授予
  Provider、Skill、CI、Fleet 或人工会话任何流程状态、push、merge、release 权威。
version: 3.0.0
created: 2026-07-04
changelog:
  - 3.0.0: 退役供应商会话持有流程控制权的旧合同；改为统一 Kernel Run Controller、
    role Attempt、machine-only Fleet Supervisor、exact-SHA authorization、effect
    receipt 与 production-verified 完成语义。
---

> 所有输出使用简体中文。

# Harness Controller — 统一 Kernel 平台合同

## 1. 身份和控制权

本 Skill 是 Kernel Harness 的人类可读合同，不是运行中的编排进程。

- 全平台只有一份确定性的 `Kernel Run Controller` 实现。
- 每个 `run_id` 一个逻辑 Controller；状态、租约、游标和恢复证据互相隔离。
- 物理上可由同一 Brain 进程承载多个逻辑 Controller，但不得共享 Run 私有状态。
- `Planner / Proposer / Reviewer / Generator / Evaluator / Judge / Reporter`
  采用 **Attempts per role**；角色 Attempt 只完成所派任务，不拥有 Run。
- Provider session 是可替换的执行资源，不是状态机真相。
- `Fleet Supervisor = machine-only`：只负责机器准入、容量、公平性和放置。
  它不得批准合同、裁决质量、授权合并或批准发布。

控制面真相来自 Brain 持久状态：

```text
tasks
+ initiative_runs
+ initiative_contracts
+ orchestrator_decision_log
+ harness_attempts
+ append-only receipts/events
```

Provider 输出、终端文本、Skill 文案、本地进度文件和进程存活都不是最终真相。

## 2. Golden Path

```text
task_born
→ intent_approved
→ planned
→ contract_approved
→ generated
→ ci_passed
→ evaluated
→ judged
→ human_reviewed | auto_review_eligible
→ merge_authorized
→ merged
→ staging_queued
→ staging_running
→ staging_passed
→ production_deploying
→ production_verified
→ reported
→ done
```

每次状态推进都必须绑定：

```text
task_id + run_id + attempt_id/evidence owner
+ repository + PR number
+ exact head/merge SHA
+ contract/policy version
+ freshness deadline
```

`failed`、`blocked`、`needs_context`、`cancelled`、`skipped`、`unknown`、超时和陈旧
SHA 都不是 `passed`。缺证据或证据冲突一律 fail-closed。

## 3. 角色 Attempt 合同

Controller 只创建冻结的 TaskBundle，并接受通过 schema、身份、租约和 nonce 校验的
Result Receipt。

### Planner

- 输入：批准后的意图、既有 FR/NFR/Invariant、范围、真实链路。
- 输出：机器可判定的计划与范围边界。
- 禁止：写代码、改合同测试、批准自己的计划。

### Proposer / Reviewer

- Proposer 产合同草案；Reviewer 做独立对抗审查。
- 合同批准后内容和 digest 冻结。
- Revision 产生新 Attempt；不能覆盖旧 verdict。
- 同一结果反复出现时进入结构化熔断/人审，不做无变化重试。

### Generator

- 在 Attempt-owned workspace 内按 Red → Green 实现。
- 只产候选 patch/commit 与结构化证据。
- push/建 PR 只能由 server-owned mutation broker 执行。
- Provider 容器不持有 GitHub mutation credential。

### CI

- CI 只产生当前 SHA 的观察证据。
- 只有明确适用且成功的检查可形成 `CI_PASS@sha`。
- cancelled、timed out、neutral、unknown 或无适用性证明的 skipped 都拒绝。
- CI 不拥有 Kernel PR，也不持有合并授权。

### Evaluator

- 使用 server-frozen verification commands 和当前 SHA 的只读 workspace。
- Provider 不能替换验证命令，不能用任意 shell 命令伪造绿色结果。
- 不可验证项不得静默 PASS。

### Judge

- 独立读取合同、Evaluator 证据、当前 PR/Git 真相并给机器裁决。
- Judge 不能修改候选实现，也不能执行 push、合并或发布。

### Reporter

- 只在生产效果已经确认后收账。
- 报告必须回写 verdict、concerns、learning、版本/SHA 和 receipt identity。
- 报告完成不能替代 staging/production 效果确认。

## 4. 合并授权和副作用回执

合并是 server-owned、一次性的受控副作用。

1. 当前 PR 必须有不可变 Kernel ownership record。
2. CI、Evaluator、Judge 以及适用的人审证据必须全部绑定同一 exact-SHA。
3. `mergeGate()` 只能为当前 SHA 签发一次 `merge authorization`。
4. 任意新 commit、PR identity 冲突、证据过期或缺失都会使旧授权失效。
5. effect executor 消费授权前后都重新读取 GitHub 外部真相。
6. 成功后追加不可修改的 **effect receipt**，记录授权、PR、head SHA、merge SHA、
   effect identity、观察时间和执行结果。
7. 进程在副作用后、回执前崩溃时，恢复逻辑先查询外部状态，再幂等补回执；
   不得盲目重放。

禁止以下对象自行推导或执行合并：

- Provider / Role Attempt；
- 本 Skill 或任何 LLM 会话；
- CI job；
- Fleet Supervisor；
- orphan/shepherd/watchdog；
- 依据标题、branch regex、label、task result 文本作判断的自动化。

任何人工命令也必须消费同一授权并产生同一回执，不能成为旁路。

## 5. 人审策略

人审是额外判定点，不替代机器门。

必须人审：

- 首次执行某行为或能力；
- 新功能、合同变化、schema/migration；
- CI/workflow、安全、凭据、发布或核心编排变化；
- ownership、scope、risk 不明确；
- 证据过期或 head SHA 改变；
- 主理人显式要求。

只有同时满足以下条件才可进入 `auto_review_eligible`：

- 相同行为版本已有成功 production receipt；
- 合同和允许路径类别未变化；
- diff 小且有确定边界；
- 不属于受保护类别；
- 当前机械证据全部通过。

人审 receipt 必须绑定 `task_id/run_id/review_request_hop/current_sha`，SHA 变化立即失效。
执行体没有自批权；等待人审时保持 durable waiting，不靠前台进程阻塞或自我终止。

## 6. Staging、Production 和完成语义

`merged` 不等于完成。Merge receipt 只允许创建绑定 merge SHA 的 ReleaseRun：

```text
merged
→ staging_queued
→ staging_running
→ staging_passed(merge_sha)
→ production_deploying(merge_sha)
→ production_verified(merge_sha, deployed_versions)
```

- staging 不可由 risk level 跳过。
- staging FAIL/unknown/unavailable 不得 promote。
- production 只消费某个 ReleaseRun 的授权，不能选择“最新 main”。
- production receipt 至少包含健康检查、版本/SHA 回读、必要 E2E、部署版本和回滚锚点。
- 只有 `production_verified + reported` 才能进入 `done`。

## 7. 存活、恢复和取消

- Controller 用 Run lease/heartbeat 保证每个 `run_id` 只有一个 active owner。
- Attempt Supervisor 负责 Attempt 的启动、心跳、超时、callback、取消和清理。
- Kernel Attempt 活性读 `initiative_runs` 与 `harness_attempts`，不读取 relay 容器日志。
- 旧 relay 在回滚窗口继续使用自己的容器/事件证据，不能和 Kernel 证据混判。
- 恢复从 DB + Git + PR + receipt 外部真相重建；不得依赖会话记忆。
- 同机 resume 必须绑定 receipt 证明的 actual machine；否则开新 Attempt/reconcile。
- 取消必须 durable、幂等、可在进程重启后继续清理。

## 8. 11 要素检查

每个 Golden Path Step 都必须回答并留证：

1. FR
2. NFR
3. Invariant
4. 判定点
5. 保质期
6. 死亡告警
7. 失败语义
8. 效果确认
9. 输入对抗面
10. 账本保鲜
11. task/run/PR/SHA/release 两轴衔接

`green` 至少要求绑定版本/SHA 的可重复行为测试；P0 守卫还必须 proven-to-fire。
Skill 文案、静态 grep、Agent 自报或一次 smoke 不能单独制造等价证明。

## 9. 禁止事项

- 禁止 Provider/Skill/CI/Fleet 成为流程 owner。
- 禁止角色 Attempt 直接 push、合并、发布或制造批准事件。
- 禁止标题、分支名、label 或自由文本充当 ownership/authorization。
- 禁止把 skipped/unknown/stale 当 success。
- 禁止使用宿主共享 workspace、共享 credential home 或跨 Attempt session。
- 禁止基于前台终端生命周期结束/关闭 Harness Run。
- 禁止在 production effect receipt 前写 `done`。
- 禁止复制 Provider 专用状态机、平行账本或第二份 regression SSOT。

## 10. 兼容与回滚

旧 relay 只作为明确的回滚执行体保留；它不定义新平台语义，也不能向 Kernel 写入伪造
Attempt/receipt。选择旧运行时必须由 server-owned policy 明确记录，且守卫不得拿
relay 容器缺失判定 Kernel Run 死亡。

当本文与旧会话脚本、历史 handoff 或 Provider 特有 hook 冲突时，以 Kernel
server-owned 合同与 exact-SHA receipts 为准；旧文件只能作为 legacy evidence，
不能恢复控制权。
