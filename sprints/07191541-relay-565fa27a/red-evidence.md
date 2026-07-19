# Red Evidence — smoke-verify-headless-dispatch 565fa27a

> 生成日期：2026-07-19
> Task ID：565fa27a-4b5b-4eb7-905e-b6fb61eb8413

---

## Red 证据（Commit 1 时点）

Commit 1 SHA: f69ebb1bf

- `sprints/07191541-relay-565fa27a/tests/contract-red.test.sh` 已提交
- `scripts/smoke/e2e/relay-565fa27a.sh` **尚未存在**
- 验收链路未固化：合同存在，但无 e2e smoke 脚本将其固化到 CI

Red 含义：合同条款已写下（B-01~B-06），但执行验证的 smoke 脚本缺失，属于"断言存在但未执行闭合"状态。

---

## Brain API 实际返回摘要（脱敏）

采样时间：2026-07-19

| 字段 | 值 |
|------|-----|
| id | 565fa27a-...（已知，不重复） |
| status | in_progress |
| task_type | harness_initiative |
| payload.mode | headless |
| payload.executor | claude |
| payload.orchestrator | skill-relay |
| payload.dispatched_by_orchestrator | true |
| payload.smoke_test | true |

> 脱敏说明：仅列出验收相关字段，不输出 token/凭据类字段。完整响应不入库。

---

## Green 证据（Commit 2 时点）

- `scripts/smoke/e2e/relay-565fa27a.sh` 已存在且 chmod +x
- B-01~B-05 全部通过（API 返回值与断言匹配）
- B-06 concern 级（phase-events 记录数待跟进，不阻断）
- `packages/quality/smoke-allowlist.txt` 已追加 `scripts/smoke/e2e/relay-565fa27a.sh`

---

## 未覆盖真实链路

| 链路 | 状态 |
|------|------|
| initiative_runs 当前 task run 记录 | CONCERN — headless session 初次运行无 run 行，不阻断 |
| harness/phase-events initiative_id 记录 | CONCERN — 暂无记录，待跟进 |
| UI/Dashboard 验证 | N/A — 本 sprint 范围不含 UI |
