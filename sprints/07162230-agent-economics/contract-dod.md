# Contract DoD — 代理经济学仪表盘

sprint: 07162230-agent-economics
task_id: 40386870-31b0-4d24-b18a-fdfb129715d9
target_environment: local_api

---

## DoD 检查清单（Planner 执行，Evaluator 验收）

### 代码实现

- [ ] **D1** `packages/brain/migrations/351_initiative_run_events_tokens.sql` 已创建，使用 `IF NOT EXISTS` 加 `tokens_in BIGINT` 和 `tokens_out BIGINT` 列
- [ ] **D2** `packages/brain/src/events/initiativeRunEvents.js` 中 `updateInitiativeRunEvent` 函数已扩展参数：新增 `tokensIn`、`tokensOut`，并在 UPDATE 语句中写入对应列
- [ ] **D3** `packages/brain/src/routes/harness-callback.js` relay 分支（`cecelia-relay-*`）已解析 `req.body.usage`：提取 `input_tokens`、`output_tokens`、`total_cost_usd`，并调用 `updateInitiativeRunEvent`
- [ ] **D4** relay 回调 usage 写库失败时使用 `console.warn`（non-fatal），不返回 500，不中断 200 ack
- [ ] **D5** 负数 `total_cost_usd` 不写库（写 NULL 或跳过）；`tokens_in`/`tokens_out` 独立校验（不受 cost 影响）
- [ ] **D6** `packages/brain/src/routes/economics.js` 已创建，实现 `GET /economics/prs?days=N`，JOIN `initiative_run_events` 按 task 聚合，返回 `{ prs: [...], summary: {...} }`
- [ ] **D7** `packages/brain/server.js` 已 import `economicsRoutes` 并注册 `app.use('/api/brain/economics', economicsRoutes)`

### 测试

- [ ] **D8** `packages/brain/src/__tests__/economics-relay-usage.test.js` 已创建，T1 failing test（修复前 FAIL，修复后 PASS）
  - 不 mock `updateInitiativeRunEvent`，真实走 DB 落库断言
  - 断言 `cost_usd = 0.035`（非 NULL）、`tokens_in = 5000`、`tokens_out = 2000`
- [ ] **D9** `packages/brain/src/__tests__/economics-prs.test.js` 已创建，T2 failing test（修复前 FAIL，修复后 PASS）
  - 预置 fixture 数据（3 个 task，已知 cost_usd）
  - 断言 `summary.total_cost_usd` 之和（±0.0001）
  - 断言超出 days 范围的 event 不出现

### 现有测试回归

- [ ] **D10** `packages/brain/src/events/__tests__/initiativeRunEvents.test.js` 全通（无回退）
- [ ] **D11** `packages/brain/src/routes/__tests__/relay-smoke.contract.test.js` 全通（无回退）
- [ ] **D12** `packages/brain/src/__tests__/harness-skill-relay.test.js` 全通（无回退）

### 数据库

- [ ] **D13** migration 351 已在 Brain 启动时执行（或手动 `psql cecelia < migration.sql`）
- [ ] **D14** migration 351 幂等性验证：重复执行不报错

### Langfuse 凭据（条件性）

- [ ] **D15** 已执行 `op item get "langfuse" --vault CS --format json` 尝试获取凭据
  - 若存在：落 `~/.credentials/langfuse.env`（chmod 600），Brain 进程 reload
  - 若不存在：PR description 注明缺少的 key（`LANGFUSE_PUBLIC_KEY`/`LANGFUSE_SECRET_KEY`/`LANGFUSE_BASE_URL`），不造假凭据，`/api/brain/langfuse/recent` 保持 `credentials_missing` 降级

### E2E 验收

- [ ] **D16** E2E-1：relay 回调 usage 落库验证（见 contract-draft.md ## E2E 验收 E2E-1）
- [ ] **D17** E2E-2：`GET /api/brain/economics/prs?days=7` 返回含 `prs` + `summary` 的 JSON
- [ ] **D18** E2E-3：Langfuse 端点返回 `success:true`（若凭据存在）或合法降级（若缺失）
- [ ] **D19** E2E-4：migration 351 幂等性（重复执行两次无错，列存在）

### Invariant 检查

- [ ] **D20** 无 `cost_usd` 负数写入（禁估算造假）
- [ ] **D21** secrets 不进 git（`.env` 不 commit）
- [ ] **D22** migration 使用 `IF NOT EXISTS`（migration 幂等）
- [ ] **D23** economics 端点鉴权与现有 Brain 路由模式一致（无裸露端点）
- [ ] **D24** 日志脱敏：relay 回调日志不打印 usage 中的 token 内容

---

## 验收标准（Evaluator 判定通过的门槛）

所有 D1~D24 均为必须项。D15 中 Langfuse 凭据条件：

- 若 1Password CS 中有 Langfuse 凭据 → D18 必须 `success:true`
- 若 1Password CS 中无 Langfuse 凭据 → D18 降级 `credentials_missing` 为合法，PR description 注明缺失条目即可通过

---

## 版本 Bump 要求

Brain 本次新增 migration（351）+ 新端点，需 semver bump（patch 或 minor，取决于 Brain 当前版本策略）。

---

## 测试命令参考

```bash
# 单跑 T1
cd /workspace && npx vitest run packages/brain/src/__tests__/economics-relay-usage.test.js

# 单跑 T2
cd /workspace && npx vitest run packages/brain/src/__tests__/economics-prs.test.js

# 全量回归（被影响测试）
cd /workspace && npx vitest run \
  packages/brain/src/events/__tests__/initiativeRunEvents.test.js \
  packages/brain/src/routes/__tests__/relay-smoke.contract.test.js \
  packages/brain/src/__tests__/harness-skill-relay.test.js
```
