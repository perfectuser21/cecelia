# 独立裁判（第 2 轮）

- 裁决：**FAIL**（contract_gap）
- 模型：gpt-5.6-sol
- 复核的 QA 报告：05-qa-report-r2.md
- 总评：编码/裸冒号读取、spans 明细、实时触发器汇总及原路由兼容性均有真实 HTTP 证据。当前不能完全通过：合同主动排除了合法 run_id `stats`，而预览实测该值返回500并永远无法读取对应记录；另有 NUL 输入导致500的低概率合同缺口。

## 需求覆盖

### I-1
- 未满足
- 依据：packages/brain/src/routes/runs-read.js:35-47 使用参数化查询返回 runs 行；T-1、T-3 真实验证编码及裸冒号 run_id 返回 200 且字段和值正确。但 X-4 证明合法短 run_id `stats` 在到达新路由前被 server.js:429 的既有路由截获并返回 500，因此接口并非对所有需求允许的 run_id 可用。合同在“未覆盖真实链路”中明确排除了该值，实质缩小了需求。

### I-2
- 满足
- 依据：packages/brain/src/routes/runs-read.js:14-30、40-42 在只读可重复读事务中查询 spans，并按 started_at、created_at、id 升序排序；T-5 真实验证乱序写入后按 started_at 升序返回、字段齐全、总费用为 0.3，且无 include 或 include=foo 时没有 spans；X-1 还验证逗号及重复 include 参数。合同 S-2、Q-3 完整覆盖。

### I-3
- 未满足
- 依据：packages/brain/src/routes/runs-read.js:35-53 实现空值、超长、404及非法 URL 编码处理；T-8、T-9 真实验证常规不存在值、SQL 注入式输入、空值、200/201 字符和非法编码。但 X-4 显示 `stats` 返回 500，X-3 显示合法 URL 编码且长度合规的 `a%00b` 也返回 500 和原始 PostgreSQL 错误，未完全达到“不存在返回 404且不返回500”。合同分别主动排除了前者，并以“数据库异常返回500”容许了后者。

### I-4
- 满足
- 依据：packages/brain/src/routes/runs-read.js:23-24、42 每次请求直接查询数据库，没有缓存；T-1/T-2 在预览环境真实 POST span 后立即 GET 到触发器生成的总记录，T-6/T-7 进一步真实验证连续写入后 outcome、cost_usd、header_source 立即更新以及重复上报不重复计费。合同 S-3、S-4 与 Q-1、Q-4 覆盖完整。

### I-5
- 满足
- 依据：packages/brain/server.js:475-477 将新路由放在原有 run-definitions、run-reconciliation 之前，新路由仅注册 `/` 与 `/:run_id`；T-10 在相同数据库和环境变量下逐项对比本分支与 main，原有两段接口的状态码及 error.code 完全一致，并验证 reconciliation 仍含 evidence_status。合同 S-3、Q-7 直接覆盖。

## 问题

### J-1
- 类型：contract_gap
- 严重度：重要
- 对应：I-1、I-3
- 位置：02-spec.md“未覆盖真实链路”；packages/brain/server.js:429、packages/brain/server.js:472；X-4
- 说明：需求没有把 run_id 限定为 `coding-workflow:<uuid>`，除空串和超过 200 字符外也没有声明 `stats` 为保留字，因此已有 run_id 恰为 `stats` 时应能按该 ID 查询，不存在时也应返回 404。合同却在“未覆盖真实链路”中主动排除这个值，没有要求调整 server.js:429 与新路由的挂载优先级。X-4 的真实请求已证明 `/api/brain/runs/stats` 被更早的 contentPipelineRoutes 接走并返回 500 `invalid input syntax for type uuid: "runs"`；即使 runs 表中存在该 ID，用户也无法通过新增接口读取。这是合同把需求允许的输入域缩小所致，需要先修正规格再决定路由调整。

### J-2
- 类型：contract_gap
- 严重度：建议
- 对应：I-3
- 位置：02-spec.md S-1；packages/brain/src/routes/runs-read.js:38-47；X-3
- 说明：合同只把空白、超过 200 字符和非法百分号编码定义为输入错误，同时规定其余数据库异常返回 500；这遗漏了 URL 编码合法但 PostgreSQL text 参数无法接受的 NUL 字节。X-3 真实证明 `a%00b` 返回 500，并将 PostgreSQL 原始错误直接回显，而不是稳定的 400或404。该输入不符合当前真实 run_id 形状，影响较低，但合同应明确将不可入库字符判为400，或明确收窄 run_id 字符集，避免与 I-3 的“不返回500”目标冲突。
