# 设计：Kernel Harness Golden Path × 11 要素加粗加厚

日期：2026-07-27
状态：主理人已确认以既有 11 要素为 Golden Path 基线；实施与等价证明进行中
优先级：P0/P1 等价证明
范围：Cecelia Kernel Harness，从任务诞生到生产验证与学习收账

## 0. 决策摘要

本设计不是重建 DevOps，不迁移 Claude Code hook 文件，也不新增平行的
“Behavior Ledger”。

Kernel Harness 已有基础骨干。本轮工作把它登记为一条 Golden Path，并复用现有：

1. `docs/current/SYSTEM_MAP.md` 的 DevOps 七大机制总账；
2. `journeys / journey_steps / journey_features / journey_step_links` 承诺地图；
3. `packages/brain/src/lib/eleven-elements-ledger.js` 的 11 要素；
4. 根 `regression-contract.yaml` 的可执行回归契约。

目标是：

> 用 11 要素逐步检查和加厚 Kernel Harness Golden Path，并对旧 Claude Code
> 平台全部 P0/P1 安全与质量行为完成 Provider-neutral 等价证明。

禁止新建第二套生命周期状态机、第二份回归 SSOT 或第二本行为账本。

## 1. 与现有设计的关系

本设计是以下规格的加厚层，不替代它们：

- `2026-07-21-provider-neutral-harness-design.md`：定义 Kernel、TaskBundle、
  HarnessResult、Attempt、Provider Adapter；
- `2026-07-25-provider-neutral-harness-commander-fusion-prd.md`：定义 Kernel Run
  Controller、LLM Commander、Fleet/设备调度边界；
- `2026-07-17-mj5-knife1-ledger-design.md`：定义承诺地图和 11 要素格子；
- `docs/current/SYSTEM_MAP.md`：定义 DevOps 七大机制及完备性口径。

四层关系：

```text
DevOps 七大机制
  └─ Kernel Harness Golden Path（承诺地图）
      └─ 每个 Step 的 11 要素完整度
          └─ regression-contract + proven-to-fire 等价证据
```

各层回答不同问题：

| 层 | 回答什么 |
|---|---|
| 七大机制 | 整个 DevOps 闭环有没有“家” |
| Golden Path | 一次 Kernel Harness 从出生到结束怎么走 |
| 11 要素 | 每一步是否定义完整、可验证、会保鲜 |
| 等价证据 | Claude/Codex/Grok 下守卫是否真的同等生效 |

## 2. Kernel Harness Golden Path

### 2.1 骨干

```text
S0 Task Born
→ S1 Intent / PrepPRD
→ S2 Planner
→ S3 Contract GAN
→ S4 Generator
→ S5 CI
→ S6 Evaluator
→ S7 Independent Judge
→ S8 Risk-based Human Review
→ S9 Merge
→ S10 Staging
→ S11 Production
→ S12 Report / Learning / Complete
```

### 2.2 每步承诺

| Step | 承诺 | 成功证据 | 失败时 |
|---|---|---|---|
| S0 Task Born | 每个任务有稳定身份、来源、仓库、环境、风险和锚点 | task/run/anchor 可查 | 信息不足则不点火 |
| S1 Intent | 用户意图、成功标准、真实旅程和依赖被冻结 | approved intent/PRD artifact | 等待补充或人工确认 |
| S2 Planner | 计划覆盖 FR/NFR/Invariant/真实 E2E，范围足够薄 | planner artifact | 修订计划 |
| S3 Contract GAN | 对抗审核后的合同可执行且批准后不可偷改 | approved contract + digest | proposer/reviewer 收敛或熔断 |
| S4 Generator | 在受控工作树先 Red 后 Green，创建 Harness-owned PR | commits、PR、artifact | 同 PR 修复或明确失败 |
| S5 CI | 客观检查全绿，只产证据，不持有 Harness merge 权 | `CI_PASS@head_sha` | 返回 Generator Fix |
| S6 Evaluator | 新 session 真跑合同、反作弊和真实 E2E | `Evaluator_PASS@head_sha` | 修复；不可验证不得 PASS |
| S7 Judge | 独立复核 Evaluator 证据并给最终机器裁决 | `Judge_PASS@head_sha` | 阻断或补证据 |
| S8 Human Review | 首次/高风险变更在 merge 前由主理人查看 | `Human_APPROVED@head_sha`，或绑定 SHA 的免审策略证据 | 持久等待，不自批 |
| S9 Merge | 只有唯一 Merge Authority 在全部门禁满足后合并 | GitHub PR MERGED + merge SHA | 冲突/漂移/缺门禁即阻断 |
| S10 Staging | 部署并验证刚合并的精确 artifact | staging E2E + regression PASS@sha | 禁止 promote |
| S11 Production | 按发布策略 promote、验活并留回滚锚点 | prod health/smoke + release manifest | 回滚或冻结 |
| S12 Report | 更新承诺地图、回归、学习和外部状态后才收账 | report/sync/ledger evidence | done_with_concerns 或重试 |

### 2.3 完成语义

`merged` 不等于 `completed`，`staging_pass` 也不等于 `production_verified`。

成功终态必须满足：

```text
PR merged
AND staging verdict = PASS
AND production promotion 已解决
AND production health/smoke = PASS
AND rollback anchor 已记录
AND report/承诺地图/学习同步已完成
```

客户线等待生产放行时状态为 `pending_promote`；不得提前写 `completed`。

### 2.4 承诺地图落点

复用“一条 GP = 一条 journeys 行”的既有建模：

| 字段 | Kernel Harness 值 |
|---|---|
| journey/name | Kernel Harness Delivery |
| home | `factory`（家④工厂） |
| domain | `DevOps / Harness` |
| trigger | 带合法 anchor 的 Harness initiative 被批准并进入可点火状态 |
| endpoint | 对应 production artifact 已验证，回滚锚点与报告/学习已收账 |
| journey_steps | S0-S12；每步保存本设计 §2.2 的 promise |
| element cells | 每步 11 要素，使用既有 `journey_step_links.cell_kind='element'` |
| assertion_ref | 指向根 `regression-contract.yaml` 条目、行为测试或人工判定证据 |

不得为这条 Golden Path 新建 `kernel_steps`、`behavior_ledger` 等同义表。

### 2.5 与 DevOps 七大机制对齐

| 七大机制 | Golden Path 覆盖 |
|---|---|
| 认知 | S0 及全程外部真相观测 |
| 意图 | S0-S3 |
| 生产 | S2-S5 |
| 质检 | S3-S9 |
| 生存 | S0-S12 的心跳、租约、恢复、watchdog |
| 交付 | S9-S12 |
| 学习 | S12，并回流下一次 S0-S3 |

## 3. 11 要素在 Kernel Harness 中的统一含义

沿用既有 11 个名字，不发明同义字段：

| 要素 | 在 Kernel Harness Step 中必须回答 |
|---|---|
| FR | 这一步必须完成什么可观察功能 |
| NFR | 安全、可靠性、幂等、恢复、时限、资源约束是什么 |
| Invariant | 无论 Provider/设备如何变化都不可破坏什么 |
| 判定点 | 哪个确定性 gate、测试或人审决定能否前进 |
| 保质期 | 证据多久失效、何时必须重验 |
| 死亡告警 | 卡住、失联、假绿、漂移时谁能发现 |
| 失败语义 | FAIL/SKIP/BLOCKED/NEEDS_CONTEXT 分别意味着什么 |
| 效果确认 | 如何证明真实外部状态已发生，而非只听 Agent 声称 |
| 输入对抗面 | Agent、恶意输入、陈旧 SHA、伪证据如何尝试绕过 |
| 账本保鲜 | 谁在何时自动回写状态和最近验证证据 |
| 两轴衔接 | OKR/KR 的季度意志如何连到 Journey/Ability/Kernel 交付资产，并能反向对账结果 |

每个 Step 的 11 个格子只允许以下状态：

- `gray`：尚未定义；
- `red`：已知缺口或证明失败；
- `pending`：定义存在，但缺真实等价证据；
- `green`：已有绑定版本/SHA 的自动证据；
- `na`：经明确理由判定不适用。

`green` 不能只靠文档、Skill 文案或静态 grep；P0/P1 至少需要一次可重复执行的
行为测试，关键守卫还需要 proven-to-fire。

### 3.1 P0/P1 口径

| 级别 | 本设计中的含义 | 切默认要求 |
|---|---|---|
| P0 | 失守会造成越权写入、凭据泄露、绕过 merge/release、错误生产变更、跨租户影响或假完成 | 全部等价证明为 green；不得 unknown/pending |
| P1 | 失守会造成质量退化、不可恢复、错误路由、证据丢失、长期漂移或重复事故 | 全部完成归位和等价证明；无未解释 red/unknown |

优先级只决定实施顺序，不表示 P1 可以在 Kernel 切默认时被省略。

## 4. 加粗与加厚

### 4.1 加粗骨干（P0）

“加粗”是把跨 Step 的不可绕过规则放到必经之路：

1. Harness 身份使用稳定 metadata，不依赖 `feat(harness):` 标题猜测；
2. CI、Generator、Evaluator、Judge 均无 Harness merge capability；
3. Merge Authority 只接受当前 SHA 上的 CI/Evaluator/Judge/Review 证据；
4. 新 commit 自动使旧 verdict 和旧人审批准失效；
5. staging 是主 Run 的阻塞阶段，不是 report 后 best-effort 子任务；
6. production promotion 及验活进入同一终态合同；
7. Claude hook 中的 branch、credential、write-scope、push 等行为下沉为
   Kernel policy + Runner enforcement + Git/GitHub final gate；
8. 任一 Provider 缺失统一守卫能力时 fail-closed，不以“该 Provider 没有 hook”
   为理由降级；
9. 外部 Git/PR/部署事实优先于 Session 自述，崩溃后可重建；
10. 所有旁路 merge/push/promote 都有检测和告警。

### 4.2 加厚步骤（P1）

“加厚”是补齐每个 Step 的 11 要素：

- 明确成功和失败语义；
- 把文字约束变成确定性 gate；
- 增加正常、失败、恢复和对抗场景；
- 记录证据版本、Provider、设备、attempt、PR/deploy SHA；
- 设置保质期、nightly/release 重验和死亡告警；
- 自动回写承诺地图与回归契约；
- 对不可自动化部分保留明确的人审判定点。

## 5. 旧 Claude Code P0/P1 行为如何归位

不迁移 hook 文件；提炼 hook 所保护的行为，挂到对应 Step/要素。

| 旧行为族 | Golden Path 位置 | 主要 11 要素 | Unified owner |
|---|---|---|---|
| branch-protect / main-repo-write | S4/S9 | Invariant、输入对抗面、效果确认 | Kernel policy + Runner + GitHub |
| credential-guard / bash-guard | S4/S5 | NFR、Invariant、失败语义 | Runner enforcement + CI secret scan |
| branch guard / push precheck | S4/S5 | 判定点、输入对抗面 | Runner + repository precheck + CI |
| DevGate / TDD / DoD | S3-S6 | 判定点、效果确认、两轴衔接 | Contract/Generator/CI/Evaluator |
| stop / orphan / watchdog | 全程，重点 S4-S12 | 死亡告警、账本保鲜、失败语义 | Attempt supervisor + Kernel reconcile |
| evaluator / judge | S6/S7 | 判定点、效果确认、对抗面 | Kernel attempts + independent judge |
| branch protection | S5/S9 | Invariant、判定点 | GitHub external final gate |
| staging / promote / rollback | S10/S11 | 效果确认、失败语义、保质期 | Release state machine |

旧条目必须先标记真实状态：

- `active`：当前确实执行；
- `shadowed`：仍存在但已被别的机制取代；
- `retired`：明确不再需要；
- `drifted`：文档/测试与当前行为矛盾；
- `unknown`：尚未完成真实审计。

`regression-contract.yaml` 中的旧条目不能未经审计直接当作 Kernel 合同。

## 6. 等价证明合同

### 6.1 最小证据单位

每个 P0/P1 格子的证明至少包含：

```json
{
  "invariant_id": "P0-MERGE-001",
  "journey_step": "S9",
  "element": "输入对抗面",
  "legacy_behavior": "CI must not merge harness-owned PR",
  "kernel_enforcer": ["kernel.merge_gate", "github.branch_protection"],
  "provider": "codex",
  "machine": "us-mac-m4",
  "attempt_id": "uuid",
  "artifact_sha": "git-sha",
  "test_command": "path/to/test",
  "observed_result": "blocked",
  "verified_at": "timestamp",
  "expires_at": "timestamp-or-null"
}
```

该结构是证据 envelope，可落入既有 decision/event/result/contract 载体；本设计不要求
新建独立账本表。

### 6.2 Provider 等价矩阵

每个 P0/P1 invariant 必须至少验证：

| Provider | 正常路径 | 违规路径 | 恢复路径 |
|---|---:|---:|---:|
| Claude | PASS | 被阻断 | 可恢复 |
| Codex | PASS | 被阻断 | 可恢复 |
| Grok | PASS | 被阻断 | 可恢复 |

若 Provider 本身不支持某能力，由 Runner/Kernel/GitHub 外层提供相同行为；结果仍须
fail-closed。Provider-specific hook 只能做纵深防御，不能成为唯一权威。

### 6.3 Proven-to-fire

下列 P0 守卫必须故意违规并看到真实阻断：

1. 直接写 main；
2. 提交/输出凭据；
3. CI 尝试抢先 merge；
4. 伪造或复用陈旧 SHA verdict；
5. Reviewer/Evaluator/Judge 试图越权 push/merge；
6. staging FAIL 后尝试 promote；
7. 未人审的新功能尝试 merge；
8. Run/Attempt 中途死亡后的恢复；
9. production 验活失败后的冻结/回滚。

只有 mock 或纯函数单测不足以把这些格子标绿。

## 7. Risk-based Human Review

人工 Review 只是一道条件门，不能替代机器门。

必须人审：

- 新的用户可见能力或首次 Journey；
- 首次外部集成、凭据、数据迁移或部署路径；
- 修改 P0/P1 invariant；
- blast radius 高或不可快速回滚；
- 风险分类未知；
- 主理人显式设置 `review_required=true`。

可免人审：

- 已批准合同下的重复实现；
- 局部 bug fix；
- `small` / `thicken`；
- 不改变行为合同的维护任务；
- 风险分类有机器证据且所有硬门通过。

免人审只跳过 S8；不得跳过 S5/S6/S7/S10/S11。

## 8. 当前基础版与已知红/黄格

基础版已具备：

- Provider-neutral TaskBundle/HarnessResult/Attempt；
- Kernel 确定性路由与恢复骨架；
- Planner/GAN/Generator/Evaluator/Judge 角色链；
- Evaluator/Judge 与当前 PR SHA 绑定的 merge gate；
- risk-based human review；
- merge 后创建 staging E2E task；
- Cecelia 内部线 staging PASS 后的 dashboard promote 能力。

已知需加粗/加厚：

1. Kernel 仍是显式 `harness_runtime=kernel-v1` 路径，非唯一默认；
2. Harness-owned PR 仍以标题前缀参与 CI auto-merge 分流；
3. Runner 的 branch/credential/write/push 保护尚未成为完整 provider-neutral policy；
4. Kernel report 在 spawn staging 后即可把主 Run 标 `completed`；
5. staging task 与主 Run 终态未形成阻塞状态机；
6. 内部、客户、unknown 和 GitHub 通用发布线的 production 语义不统一；
7. 部分 promote/report 错误是 best-effort，会产生假完成风险；
8. 现有 11 要素实现对 NFR/Invariant/对抗面/效果确认的判定仍较粗；
9. 旧 regression contract 含 stop-hook 等历史漂移条目；
10. 尚无覆盖 Claude/Codex/Grok 的 P0/P1 全矩阵等价报告。

因此当前可称“基础版 Kernel Harness”，不可称“已完成旧平台等价替代”。

## 9. 推荐落地顺序

实施计划应按 Golden Path 加粗，而不是按旧 hook 文件搬运：

1. 把 Kernel Harness 登记为承诺地图 Journey，落 S0-S12 Step 与 promise；
2. 将既有 P0/P1 条目归位到 Step × 11 要素，先标 gray/red/pending；
3. 审计旧条目为 active/shadowed/retired/drifted/unknown；
4. 先补唯一身份、唯一 merge authority、SHA 证据失效等 pre-merge P0；
5. 再把 branch/credential/write/push 行为下沉到统一 policy/enforcement；
6. 将 staging/production/report 纳入主 Run 终态；
7. 建 Provider 正常/违规/恢复矩阵和 proven-to-fire；
8. 达到 P0 全绿、P1 无未知红格后，Kernel 才可成为默认；
9. 保留旧 Controller 回滚窗口，稳定期后再退役供应商专用控制职责。

每一阶段都必须更新同一承诺地图和同一 `regression-contract.yaml`，禁止另起清单。

## 10. 验收标准

- [ ] Kernel Harness 在承诺地图中有一条 S0-S12 Golden Path；
- [ ] 每个 Step 有 11 要素格子和明确状态；
- [ ] 全部旧 Claude Code P0/P1 行为都有归位、状态和 Unified owner；
- [ ] 所有 P0 invariant 在 Claude/Codex/Grok 下都有正常、违规、恢复证据；
- [ ] 关键守卫完成真实 proven-to-fire；
- [ ] CI 对 Harness-owned PR 永远不持有 merge 权；
- [ ] Evaluator、Judge、人审批准均绑定当前 SHA，漂移即失效；
- [ ] `completed` 只能在 production verified + report/sync 后出现；
- [ ] staging/promote/production FAIL 不会被 best-effort 吞成成功；
- [ ] 旧 Controller 与 Kernel 的影子对比没有未解释 P0/P1 差异；
- [ ] Kernel 切默认前有明确回滚条件和回滚演练；
- [ ] 没有新增平行状态机、平行账本或平行 regression SSOT。

## 11. 非目标

- 本设计阶段不修改运行代码；
- 不把 Claude/Codex/Grok 的 hook/skill 复制三份；
- 不把所有风险任务改为永久人工发布；
- 不取消低风险重复任务的自动 merge/promotion 能力；
- 不重构与 Kernel Harness Golden Path 无关的业务 Journey；
- 不在没有等价证据前删除旧 Controller 回滚通道。
