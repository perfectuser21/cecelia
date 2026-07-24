# Sprint PRD — Harness Kernel 收敛驱动恢复（PR #4226 回炉）

**TASK_ID**: 50170af2-fefa-41a7-b0b4-dcf1a5d7b077
**Sprint**: 07231527-relay-50170af2
**Date**: 2026-07-23
**Priority**: P0
**执行方式**: 美国本机 One Session `/dev`
**上游裁决**: `decisions.id = 9aeae77e-a4f2-47f7-a94f-d515546d1a32`

---

## 背景与裁决优先级

生产 run `d707ae20` 曾持续 529.90 分钟，记录 66 hop / 44 attempt；
evidence 问题被误派给 generator，随后多个 fix 锚定同一 SHA，进程内计数在
重启后归零。PR #4220 因接线缺口被 revert；PR #4226 第一轮虽有完整
Red→Green 与 CI 证据，独立复审仍发现 R1–R7。

本回炉 PRD 受 invariant 决策 `9aeae77e` 约束，并取代本 sprint 早期的
“固定 fix 轮数 + 短墙钟 deadline”终止模型。历史材料只解释事故来源，不再
作为验收依据。发生冲突时，优先级如下：

1. 主理人对 `9aeae77e` 的批准及 2026-07-23 两项修正；
2. `docs/superpowers/specs/2026-07-23-kernel-convergence-rework-design.md`；
3. 本 PRD、`contract-draft.md`、`contract-dod.md`；
4. 本 sprint 更早的固定预算描述。

R7 的最新裁决明确覆盖旧的“将
`kernel-approval-bridge.test.js` 恢复到 `868ee83cb` 后不可修改”约束：
T-17-c/d/e 必须改为穿过真实 Router，不得保留测试体内联复制路由逻辑。

---

## 目标

1. fix 循环由服务端可验证的收敛证据驱动；有真实进展时不设轮数上限。
2. callback 自报 SHA 必须标准化并与 GitHub 当前 PR head 对账。
3. 结构化失败集合由 append-only decision log 回放，禁止从自然语言
   feedback 推断进展。
4. 无歧义的不收敛立即 `FAILED + 人工升级`；存在 flaky 歧义的振荡先
   `wait:human_review + Bark`，绝不放行 PASS 或 merge。
5. 自动化活动 deadline 为 8 小时；开放人审期间停表，恢复时补回等待时间。
6. approval 按 `(run_id, pr_head_sha)` 幂等；同 run 的新 SHA 可再次批准。
7. R1–R7 均提供真实调用链的 Red→Green regression，既有真 PostgreSQL
   8/8、回归池与 DevGate 继续保持绿色。

---

## 收敛不变量

### 结构化证据

- CI 失败集合仅来自 GitHub `statusCheckRollup` 的失败 check 名，执行
  trim、去空、去重、排序。
- evaluator / judge 只接受显式数组型 `failure_signature`；非数组、空数组
  或非法成员均按“无结构化集合”处理。
- `reason`、`feedback`、summary 等自然语言永不参与进展判断。
- generator claimed SHA 是不可信输入；只有 40 位 hex 经小写标准化并与
  GitHub resolver 完全一致后才可落为权威 SHA。

### 允许继续

Product fix 必须先产生 resolver 确认的新 SHA。随后：

- 无结构化失败集合：新 SHA 即进展；
- 有结构化失败集合：集合规模创本 run 历史新低，或该精确集合此前从未
  出现，允许继续；
- `fixRound` 仅是观测指标，不参与停止或放行。

### 立即终局

以下条件无 flaky 歧义，必须写 `phase='failed'` 并升级人工：

- resolver 确认的 callback SHA 与 intent `trigger_sha` 相同；
- claimed SHA 格式非法、resolver 不可用或 claimed SHA 与 resolver 不符；
- 无 PR generator 崩溃的服务端签名
  `{role, error_code, failure_class}` 第二次出现；
- patience 人审批准后，下一个结构化轮次仍未创历史新低；
- 8 小时自动化活动 deadline 或 4096-hop 宽兜底触发。

上述出口均不得产生 PASS、approval 或 merge。

### 暂停人审

以下条件停止自动 spawn，写 `wait:human_review` 并触发 Bark：

- 结构化失败集合与历史集合完全重现；
- 连续 3 个结构化新集合没有创历史新低；
- 相同 `evidence_invalid` repair 结构化签名第二次出现；
- judge FAIL 缺 `failure_class`，归一为 `unknown`。

人审批准只解锁一次观测。patience 固定重置为 1：下一个结构化轮次若仍
未创历史新低，立即 FAILED，不得再次请求 patience 人审；若创历史新低，
恢复常规收敛状态。

---

## 继承约束

Brain DB 中原有 17 条 harness invariant 继续适用，尤其包括：

- generator 禁止自行 merge，merge 权只属于 controller；
- verdict 必须锚定生产实体对账后的 PR head SHA；
- CI 绿色不能替代 evaluator / judge；
- harness pipeline 禁用于 infrastructure 仓库；
- staging→production 放行层不得移除；
- 判变端与终验端必须使用相同的 unknown 语义；
- relay payload 必须携带 base repo / PR URL。

本 sprint 的 Kernel 铁律更新为：

| ID | 约束 |
|---|---|
| INV-K1 | collect、derive、dispatch 与 DONE 后 deadline fence 均须接线；开放且仍锚定当前 SHA 的人审等待必须停表 |
| INV-K2 | deadline / hop 兜底只写 FAILED，不得 requeue、PASS 或 merge |
| INV-K3 | judge 缺 `failure_class` → `unknown` → `wait:human_review` |
| INV-K4 | SHA 与失败面只认服务端采集/对账的结构化证据；same-SHA、假 SHA 立即 FAILED |
| INV-K5 | 收敛历史、计数、patience 与人审解锁从 DB / decision log 回放，不以进程内变量为权威 |
| INV-K6 | evidence repair 同签名第二次进入人审；批准后再次重复立即 FAILED |
| INV-K7 | approval 校验 task/run、当前 PR SHA、request hop 和操作者；同 SHA 恰一行，不同 SHA 可各批准一次 |
| INV-K8 | 已为 `done` 或 `failed` 的 run 不得被任何 fence 覆盖 |

---

## R1–R7 功能清单

| 项 | 必须实现 | 验收核心 |
|---|---|---|
| R1 | approval 判重限定当前 `pr_head_sha` | 同 run SHA-A、SHA-B 各 202 且各一行；同 SHA 重复 409 |
| R2 | 删除固定 fix cap；hop=4096 宽兜底；8h 活动 deadline；人审停表；终态 guard | 多轮真实进展继续；deadline/watchdog 均暂停；`done` 不被覆盖 |
| R3 | judge 缺分类保守路由 | 真 `derive` 返回 `wait:human_review`，reason 为 unknown |
| R4 | approval/callback 共用 SHA normalizer + GitHub resolver | 大写合法 SHA 小写落库；短 SHA、假 SHA 均 no-progress terminal |
| R5 | null trigger / 无 PR 崩溃签名熔断 | 同服务端签名第二次 FAILED |
| R6 | evidence repair 重复签名熔断 | 第二次人审；批准后再次重复 FAILED |
| R7 | T-17-c/d/e 穿真实 Express Router | 认证、stale、重复、双 SHA 双批准均由真实路由验证 |

---

## NFR

| 维度 | 要求 |
|---|---|
| 权威性 | 所有收敛输入由服务端采集或外部 resolver 对账，执行体不能自证进展 |
| 持久性 | decision log append-only；进程重启后可完整重建失败面和人审状态 |
| 活动预算 | 自动化活动累计最多 8 小时；开放人审时间不计入 |
| 宽兜底 | `MAX_HOPS = 4096`，且只在收敛探测之后生效 |
| 竞态安全 | callback、approval、deadline 并发时不得产生多个冲突终态 |
| 终态安全 | `done` / `failed` 不可被后续 fence 覆盖 |
| 可回滚 | 非 `kernel-v1` 任务继续走既有 one-session/controller 路径 |

---

## Red→Green 测试矩阵

| 项 | Red 证明 | Green 证明 |
|---|---|---|
| R1 | 同 run 第二 SHA 仍被 run 级判重拒绝 | 双 SHA 各批准一次 |
| R2 | 固定 cap、短 deadline、watchdog 与终态覆盖仍存在 | 多轮继续、8h 停表、guard 生效 |
| R3 | judge 缺分类被派 generator | 路由 unknown 人审 |
| R4 | callback 可用自报的大写/短/假 SHA 绕过 | normalize + resolver 对账 |
| R5 | 无 PR 同签名崩溃可空转 | 第二次 FAILED |
| R6 | evidence 同签名可无限 repair | 第二次人审，批准后重复 FAILED |
| R7 | mock pool 内联路由逻辑恒真 | Supertest 穿真实 Router |
| 收敛历史 | 固定轮数或签名振荡仍决定终止 | 历史新低、新集合、重现、patience、解锁语义全覆盖 |

---

## 交付顺序

1. 可执行合同独立提交；
2. R1/R7、R4、R2、R3、R5/R6、完整收敛探测器逐项 Red→Green；
3. Brain 版本同步；
4. 回归池、真 PostgreSQL 8/8、facts-check、version-sync、DevGate；
5. 独立 evaluator 与异厂 judge；
6. GitHub check rollup 全绿后写 PR 交接评论；
7. 保持 PR 未 merge，等待独立复审 PASS 与批准 token。

---

## journey_type: autonomous
## target_environment: local_api
