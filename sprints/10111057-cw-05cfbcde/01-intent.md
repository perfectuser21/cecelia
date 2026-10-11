---
task_id: 05cfbcde-1108-4018-93d6-a48464324b11
step: intent
upstream: []
---
# Brain 新增执行记录总记录读接口 GET /api/brain/runs/:run_id

## 背景

现状：runs 表（迁移 531）只有触发器写入，没有任何读接口；/api/brain/runs 下只挂了 run-definitions 与 run-reconciliation 路由。核对某次运行的结果/费用（例如 coding workflow 的 coding-workflow:<task_id>、迁移 546 的终态回填）只能直连生产库。需要一个只读接口，按 run_id 返回总记录，并可选带上它的 spans 明细。鉴权与 GET /api/brain/spans 一致（同一套中间件或同级开放策略，以现有 spans GET 为准）。不改 runs/spans 表结构，不改写入逻辑。

### I-1
GET /api/brain/runs/:run_id（run_id 可含冒号，如 coding-workflow:<uuid>，需 URL 编码也能取到）返回 200，body 含 run_id、workflow_id、trigger_kind、started_at、ended_at、outcome、header_source、tokens_in、tokens_out、cost_usd

### I-2
带 ?include=spans 时同一响应里附 spans 数组（按 started_at 升序，每条含 occurrence_key、activity_id、outcome、cost_usd、started_at、ended_at）；不带时不返回 spans

### I-3
run_id 不存在返回 404 且 body 有可读 error，不返回 500；run_id 为空串或超过 200 字符返回 400

### I-4
用 POST /api/brain/spans 上报一条新 run 的 span 后，立即 GET 该 run 能看到触发器建出的总记录与汇总后的 cost_usd/outcome（真实读库，不是缓存）

### I-5
不影响现有 /api/brain/runs 下 run-definitions 与 run-reconciliation 路由的行为（它们原有接口照旧可用）
