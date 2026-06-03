# Sprint PRD — Brain API GET /api/brain/initiative-runs/phase-summary

## OKR 对齐

- **对应 KR**：Brain 可观测性 KR（initiative_runs 分组统计能力）
- **当前进度**：未知（无明确读取）
- **本次推进预期**：新增 1 条只读 API，方便 dashboard / 巡检按 phase 维度查看 Run 分布

## 背景

initiative_runs 表存放 Harness Sprint 的所有 Run 记录，每条 Run 有 phase 字段（如 planner/proposer/generator/evaluator/finalE2E 等）。当前没有按 phase 分组聚合的接口，外部消费方（dashboard 战情室、巡检脚本）只能拉全量后自己 group by。本次新增只读聚合 API，提供 phase 维度的 Run 分布快照。

## Golden Path（核心场景）

用户/系统从 [`GET /api/brain/initiative-runs/phase-summary` 请求] → 经过 [Brain 路由按 phase 分组聚合 initiative_runs] → 到达 [收到 `[{phase, count}]` 按 count 降序的 JSON 数组]

具体：
1. 调用方发起 `GET http://localhost:5221/api/brain/initiative-runs/phase-summary`
2. Brain 路由读取 initiative_runs 表，按 phase 分组计 count
3. 返回 200，body 为 JSON 数组 `[{phase, count}]`，按 count 降序排列；表空时返回 `[]`

<!-- Response Schema由Proposer在Step 1.1读api_registry后推导，Planner不负责定义技术规范。 -->

## 边界情况

- initiative_runs 表为空 → 返回 `[]`（HTTP 200）
- 存在 phase 为 NULL 的行 → 按"产品 What"语义，NULL phase 不进入分组结果（仅统计非空 phase）
- 多个 phase 计数相同 → 二次排序未指定，调用方不可依赖
- 只读接口，禁止任何写入；非 GET 方法（POST/PUT/DELETE）返回 405 或 404（由 Express 默认行为决定，不在本 sprint 显式断言）

## 范围限定

**在范围内**：
- 新增 1 条 GET 路由 `/api/brain/initiative-runs/phase-summary`
- 路由实现 phase 分组计数 + 按 count 降序
- 路由挂载到现有 Brain server（端口 5221）

**不在范围内**：
- 任何写入语义（POST/PATCH/DELETE）
- 时间窗口过滤、initiative_id 过滤等查询参数
- 分页、缓存、auth 鉴权
- dashboard 前端消费
- 单元测试以外的集成测试改动

## 假设

- [ASSUMPTION: initiative_runs 表已存在且含 phase 列，列类型为 text/varchar，可直接 SQL `GROUP BY phase`]
- [ASSUMPTION: Brain server 已在 localhost:5221 运行，evaluator 启动时自带]
- [ASSUMPTION: 现有 `packages/brain/src/routes/initiatives.js` 或类似路由模块可作为挂载点；具体文件位置由 Proposer 决定]

## 预期受影响文件

- `packages/brain/src/routes/initiatives.js`（或新建专门的 initiative-runs 路由文件）：新增 `/phase-summary` handler
- `packages/brain/src/server.js`（若需挂载新路由文件）：app.use 注册

## E2E 验收

```bash
# 启 Brain（evaluator 自带或假设已启）后，直接 curl 验证
curl -fsS localhost:5221/api/brain/initiative-runs/phase-summary | jq -e 'type == "array"'

# 校验降序（若结果非空）
curl -fsS localhost:5221/api/brain/initiative-runs/phase-summary \
  | jq -e 'length == 0 or ([.[].count] | . == (sort | reverse))'

# 校验每条结构含 phase + count
curl -fsS localhost:5221/api/brain/initiative-runs/phase-summary \
  | jq -e 'length == 0 or all(.[]; has("phase") and has("count"))'

echo "✅ phase-summary API 验证通过"
```

## journey_type: autonomous
## journey_type_reason: 仅涉及 packages/brain/，无 UI、无远端 agent、无 hook/skill 改动
## target_environment: local_api
## target_environment_reason: Brain 内部只读路由，evaluator 在本地 curl localhost:5221 即可验证
## journey_id: <未提供，PrepPRD 缺失>
## step_id: <未提供，PrepPRD 缺失>
