# PrepPRD 交接（补建档——task payload 缺 prep_prd_body）

> 本次 task（14a11fd8-0d2f-49e2-885b-9286fc1d76f7，标题 headed-smoke-test）的 Brain payload 未带
> `prep_prd_body` 字段。经 controller 查证：这是 Cecelia Harness Pipeline journey
> （bb8cc561-b3ee-4fec-b74d-2255694bd963）下的**重复冒烟回归任务模式**，已有 5 次先例全部走完整条
> harness-controller 链路并合并：
> - task a85e0582 → PR #3827 (tests/regression/relay-a85e0582/)
> - task cd0b936c → PR #3965 (tests/regression/relay-cd0b936c/)
> - task 049ebf93 → PR #3970 (tests/regression/relay-049ebf93/, scripts/smoke/e2e/relay-049ebf93.sh)
> - task 63db6f8a → PR #3975 (tests/regression/relay-63db6f8a/)
> - task 4bb31ef5 → PR (tests/regression/relay-4bb31ef5/, scripts/smoke/e2e/relay-4bb31ef5.sh)
>
> 本 PRD 由 controller 依据这 5 次先例的一致结构重建，非凭空创造架构。

## 背景

Cecelia Harness Pipeline（从 PRD → PR 合并的 LLM agent 编排链路）需要持续证明"headed 模式派发 →
controller 认领 → 落 initiative_runs → 走完整条链路"这条通路本身是活的、没有回归。每次 Brain 派发一个
`headed-smoke-test` 任务，就是要求当前这条 controller session 产出一份**锚定本次 task_id** 的回归证据
脚本，证明：

1. Brain 派发时 payload 的 mode/executor/orchestrator 三元组齐全，且不泄漏敏感字段
2. `initiative_runs` 表确实为本次 task 落了行，`orchestrator_host` 与 `phase` 合法
3. 复用（不重新实现）已有的 `packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh`

## 本次任务具体上下文（controller 已查证的外部真相）

- TASK_ID: `14a11fd8-0d2f-49e2-885b-9286fc1d76f7`
- journey_id: `bb8cc561-b3ee-4fec-b74d-2255694bd963`（Cecelia Harness Pipeline）
- SPRINT_DIR: `sprints/07172014-relay-14a11fd8`
- relay-runs 查证结果：`orchestrator_host=skill-relay-claude-headed`，`phase=A_planning`（真实
  spawn 成功，非 63db6f8a 那种 queued 卡死补建档路径——**本次不需要 63db6f8a 合同里的 R2 foreground
  分支判断**，直接走 049ebf93/4bb31ef5 那种标准 skill-relay-claude-headed 判定即可）
- Brain task payload 已确认三元组：`mode=headed`、`executor=claude`、`orchestrator=skill-relay`，
  且不含 token/github_token/anthropic_token/thin_prd 字段

## FR（功能需求，thin-slice）

1. **FR1**：`sprints/07172014-relay-14a11fd8/e2e-verify.sh`——复用
   `packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh`（不重新实现），并额外校验：
   - 该 smoke 脚本已在 `packages/quality/smoke-allowlist.txt` 登记（不重复登记，若已登记则跳过）
   - `GET $BRAIN_URL/api/brain/tasks/14a11fd8-0d2f-49e2-885b-9286fc1d76f7` 返回的 payload 三元组
     （mode=headed / executor=claude / orchestrator=skill-relay）齐全，且不含
     token/github_token/anthropic_token/thin_prd 敏感字段
   - `initiative_runs` 表 `initiative_id='14a11fd8-0d2f-49e2-885b-9286fc1d76f7'` 记录存在，
     `orchestrator_host` 匹配 `*skill-relay-claude-headed*`，`phase` 非 `failed` 且落在合法枚举
     `A_planning|planning|gan|generate|evaluate|done`，`started_at` 非空
2. **FR2**：对应的 `tests/regression/relay-14a11fd8/headed-smoke-contract.test.ts`（vitest [BEHAVIOR]
   用例，锚定读取 e2e-verify.sh 文本断言其包含上述校验点，结构镜像 049ebf93/4bb31ef5 先例）
3. **FR3**：contract-dod.md 的 manual:bash 验收命令必须可直接真跑本 e2e-verify.sh 并 PASS

## Invariant 约束

- 不得重新实现 `claude-headed-dispatch-smoke.sh`（已存在且已在 allowlist），只能复用调用
- 不得修改 CI workflow（4bb31ef5 先例已把该范围锁定完毕，本次任务不重复扩权）
- e2e-verify.sh 不得出现 `MOCK_` 或 `|| true` 吞错模式（与既有先例一致的反作弊要求）

## NFR

N/A（纯回归证据脚本，无性能/安全新增面）

## 未覆盖真实链路清单

- 未覆盖链路：无。本次 payload 三元组齐全、`initiative_runs` 已真实落行（`orchestrator_host=
  skill-relay-claude-headed`），走的是标准 headed 派发路径，不存在 63db6f8a 那种 queued 卡死需要
  controller 手动补建档的分支。

---
journey_type: regression
target_environment: local_api
