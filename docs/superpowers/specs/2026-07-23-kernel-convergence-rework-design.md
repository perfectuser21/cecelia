# PR #4226 Kernel 收敛驱动回炉设计

日期：2026-07-23
状态：主理人已批准（含两项修正）
适用分支：`cp-07231527-ws-50170af2`
上游裁决：`decisions.id = 9aeae77e-a4f2-47f7-a94f-d515546d1a32`

## 1. 目标与不变量

本设计只回炉 PR #4226 的 R1–R7，不创建新 PR，不 merge，不改 #4223
的审批认证语义。

修复循环从固定轮数终止改为收敛驱动：

- 有可验证进展就允许继续，不设 fix 轮数上限。
- 进展只认服务端采集或对账后的结构化证据，不读自然语言 feedback。
- 不收敛时停止自动 spawn；真正终局一律写 `phase='failed'` 并升级人工。
- deadline、hop 宽兜底、人工批准都不得产生 PASS 或绕过 merge gate。
- `fixRound` 仅作观测指标，不参与路由终止。

## 2. 方案选择

采用现有 append-only `orchestrator_decision_log` 作为收敛历史：

- 每次 reconcile 从日志回放历史失败面、SHA 和人工解锁状态。
- 不给 `initiative_runs` 增加可变 convergence JSON，避免第二账本。
- 不新增 convergence event 表；现有日志已经具备 hop、action、observed、
  detail 和 created_at，足以表达状态。
- 探测逻辑保持纯函数，外部 GitHub 对账留在 callback/ground-truth IO 边界。

## 3. 结构化失败证据

### 3.1 CI

`ground-truth.js` 从 GitHub `statusCheckRollup` 提取失败 check 名：

- 只采 `FAILURE`、`ERROR`、`CANCELLED`、`TIMED_OUT`、
  `ACTION_REQUIRED`、`STARTUP_FAILURE`。
- 名称 trim、去空、去重、排序。
- 同时保留现有 `ci = pass|fail|pending`。
- 集合来自 GitHub，不接受 generator callback 自报。

### 3.2 Evaluator / Judge

callback 只接收显式数组型结构化字段 `failure_signature`：

- 每项必须是非空字符串；trim、去重、排序。
- 非数组、空数组或非法项统一视为“无结构化集合”。
- `failure_class` 保留用于职责路由，但不能单独证明失败面缩小。
- `reason`、`feedback` 和 summary 永不参与收敛比较。

### 3.3 无 PR 崩溃

无 PR 时没有 GitHub 失败集合。崩溃签名由服务端字段组成：

```text
{ role, error_code, failure_class }
```

相同签名第二次出现立即 `FAILED + 人工升级`。这是有意从严：无 PR
崩溃循环是额度空转的主要来源。

## 4. Product fix 收敛状态机

每个 `spawn:generator-fix` intent 保存：

- `trigger_sha`：spawn 前 GitHub head；
- `failure_class`；
- `failure_set`：当前结构化失败集合或 null；
- `failure_set_key`：排序集合的确定性序列化值或 null。

generator callback 的 claimed SHA 不可信。服务端：

1. trim 并转为小写；
2. 校验 `/^[0-9a-f]{40}$/`；
3. 用与 approval route 共用的 resolver 查询当前 GitHub head；
4. 只有两者完全一致才把 resolver 的 SHA 写入 callback verdict。

大写的合法 40 位 SHA 可被标准化，但只能以小写对账值落库；短 SHA
校验失败；格式合法但虚假的 SHA 对账失败。

### 4.1 允许继续

callback 的 resolver SHA 必须不同于 `trigger_sha`。随后：

- 无结构化集合：新 SHA 即进展，允许继续。
- 有结构化集合：满足以下任一条件才允许继续：
  - 集合规模创本 run 历史新低；
  - 该精确集合在本 run 历史中从未出现。

首次结构化集合天然属于新集合。

### 4.2 立即失败

以下条件无 flaky 歧义，直接 `FAILED + 人工升级`：

- resolver 确认 callback 后 SHA 与 trigger SHA 相同；
- callback SHA 格式非法、resolver 不可用或 claimed SHA 与 resolver 不符；
- 无 PR 崩溃签名第二次出现；
- 人工解锁后的下一结构化轮仍未创历史新低。

### 4.3 暂停人审

以下条件停止自动 spawn，进入 `wait:human_review` 并触发 Bark：

- 结构化失败集合与历史集合完全重现；
- 连续 3 个结构化新集合没有创历史新低；
- 相同 `evidence_invalid` repair 签名第二次出现；
- judge FAIL 缺 `failure_class`，按 `unknown` 处理。

集合重现不直接 FAILED，避免 flaky check 让健康 run 被误杀。该人审是
暂停/升级而非终局，不能放行 merge。

### 4.4 人工解锁

人审请求按当前 PR SHA 锚定。一次批准只解锁一次自动观测：

- 解锁后 patience 固定重置为 1；
- 下一个结构化轮次若没有创历史新低，立即 FAILED；
- 不得再次进入 patience 人审；
- 若下一个轮次创历史新低，则解除该人工观察状态，恢复常规历史模型。

同一 SHA 只能批准一次，因此不能靠重复批准制造无限循环。最终 merge
仍要求当前 SHA 的 evaluator PASS、judge PASS 和 review approval 全部成立。

## 5. R1–R7 装配

### R1：按 SHA 批准幂等

批准判重从 `(run_id, action)` 改为：

```sql
run_id = $1
AND action = 'verdict:human_review'
AND detail->>'pr_head_sha' = $2
```

同 run 的 SHA-A、SHA-B 可分别批准一次；每个 SHA 并发批准仍靠 advisory
lock 保证恰一行。

### R2：熔断、deadline 与终态

- 删除 `MAX_FIX_ROUNDS` 及 `caps.fixExceeded` 的路由含义。
- 保留 `fixRound` 统计，仅供诊断。
- `MAX_HOPS` 调整为 4096，按所有 append-only 新日志行计数。
- 收敛探测在 hop 宽兜底之前执行。
- kernel run 初始 deadline 从 120 分钟改为 8 小时。
- 当前 SHA 有未完成 `effect:human_review_requested` 时，loop deadline fence
  和 relay watchdog 都暂停计时。
- approval 事务根据 request row `created_at` 把等待时长加回
  `initiative_runs.deadline_at`，恢复后只计算自动化活动时间。
- `markRunFailed` 使用 `WHERE phase NOT IN ('done','failed')`。当前 schema
  没有 `merged` phase；GitHub MERGED 会由 kernel 收敛为 `done`，不可被 fence
  覆盖成 failed。
- 所有 deadline/hop 出口只会 FAILED，不会 PASS 或 merge。

### R3：缺分类保守路由

judge FAIL 且缺 `failure_class` 时归一为 `unknown`，路由
`wait:human_review`。不再默认 generator fix。

### R4：callback SHA 承重墙

抽取 approval/callback 共用的 SHA normalize + GitHub resolver。callback
只落 resolver 对账后的值；无效或不匹配直接落可回放的 no-progress
结果，供 derive 终局。

### R5：null trigger SHA

无 PR generator 崩溃使用第 3.3 节签名回放。首次允许 recovery，第二次
同签名失败终局，不等待 8 小时。

### R6：evidence repair

evaluator evidence repair intent 保存结构化 evidence signature。第二次
同签名进入人审；批准后下一次仍相同则 FAILED。

### R7：真路由测试

删除 `kernel-approval-bridge.test.js` T-17-c/d/e 中复制 SQL/分支逻辑的
恒真测试，改为 Express 挂载真实 Router + Supertest：

- 未认证 401；
- stale SHA 409；
- 同 SHA 重复批准 409；
- 同 run 两个 SHA 两次批准均 202，且各自恰一行。

这是主理人新裁决，覆盖旧 PRD 中“该文件必须恢复到 868ee83cb 且不可修改”
的约束；不得改测试来绕实现，测试必须穿过真实路由。

## 6. 人审与 deadline 关联

`effect:human_review_requested` 必须包含 SHA、review reason 和结构化签名。
approval 必须引用 request hop。开放等待定义为：存在 request effect，且不存在
引用该 request hop 的 approval verdict。

- loop collect 前若存在开放等待，可越过过期绝对时间做一次外部重观测；
- collect 后只在请求仍锚定当前 SHA 时暂停 deadline；
- SHA 已变化且旧请求失效时，恢复正常 deadline 判定；
- relay watchdog 排除开放的人审等待；
- approval 在同一事务内写 verdict 并延长 deadline。

## 7. Red→Green 验证矩阵

每项先提交能在旧实现上断言失败的 regression，再提交最小实现：

| 项 | Red 证明 | Green 证明 |
|---|---|---|
| R1 | 同 run 第二 SHA 批准返回 409 | 两 SHA 各 202、各一行 |
| R2 | 第四个有效 fix 被 fix_cap；120min/人审过期；done 被覆盖 | 多轮进展继续、8h/停表、终态守卫 |
| R3 | judge 缺分类派 generator | 真 derive 路由人审 |
| R4 | 大写/短/假 SHA 可落库或绕过 | 标准化、拒绝、对账 no-progress |
| R5 | null SHA 崩溃可无限派 | 同签名第二次 FAILED |
| R6 | evidence repair 同签名无限派 | 第二次人审、解锁后重复 FAILED |
| R7 | mock 内联逻辑恒真 | Supertest 穿真实 Router |

最后保持既有回归池、真 PostgreSQL 8/8、DevGate 和版本同步全绿，并等待
GitHub check rollup 全绿。PR 保持未 merge，交独立 evaluator 和异厂 judge 复验。
