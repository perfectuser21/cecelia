# Sprint PRD: headless-smoke

**Task ID**: fa59d318-89ca-4b13-bee5-93cdf8c4362e
**Sprint Dir**: sprints/07240625-relay-fa59d318
**Domain**: quality
**Date**: 2026-07-24

---

## 背景

现有 smoke 测试（`claude-headed-dispatch-smoke.sh`、`codex-headed-dispatch-smoke.sh`）已覆盖 headed dispatch 的 API 验证路径，但缺少专门针对 **headless relay 运行时行为**的 smoke 测试。本 sprint 补齐该缺口：创建 `packages/brain/scripts/smoke/headless-smoke.sh`，验证 headless dispatch pipeline 的关键路径，并登记进 `packages/quality/smoke-allowlist.txt`。

---

## Invariant 约束

1. **I-01（executor_kind 路由不变式）**：Brain 对 `mode=headless` 任务必须路由 `executor_kind=relay-container`；此路由逻辑由 `packages/brain/src/task-router.js` 决定，smoke 断言其输出不得变更。
2. **I-02（smoke-allowlist 棘轮）**：已登记进 `smoke-allowlist.txt` 的脚本不得失败退出；新增脚本须同步登记，不欠债。

---

## 累积 FR

| ID | 需求描述 |
|----|---------|
| FR001 | headless dispatch 可验证性：Brain 必须接受 `mode=headless, executor=claude, orchestrator=skill-relay` 并返回 201/200 及任务 id |
| FR002 | payload.mode 字段可读回：创建后 GET 任务，`payload.mode` 必须为 `"headless"` |
| FR003 | executor_kind 路由正确性：headless 任务的 `executor_kind` 必须为 `"relay-container"` |
| FR004 | smoke 探针可清理：测试任务可通过 PATCH 设为 `cancelled`，防止 Brain tick 捡走真跑 |
| FR005 | 无外部依赖：smoke 脚本仅使用 bash + curl + python3，与蓝绿 pre-swap 环境兼容 |

---

## NFR

- **NFR-01（体积）**：smoke 脚本 < 60 行（含注释），保持可读性
- **NFR-02（依赖）**：仅 bash + curl + python3，禁止 jq / psql / node
- **NFR-03（可重入）**：测试探针 title 固定为 `headless-smoke-probe-test`，与真实 headless-smoke 任务标题区分，PATCH cancelled 清理后可重复运行
- **NFR-04（环境）**：可在蓝绿 pre-swap 环境（Brain 已就绪，无完整 DB 直连）运行
- **NFR-05（CI 棘轮）**：脚本通过后须登记进 `smoke-allowlist.txt`，失败即 CI 红

---

## 验收断言（5 项）

| # | 断言 | 验证方式 |
|---|------|---------|
| A1 | Brain 健康检查通过 | `GET /healthz` → 200 |
| A2 | POST tasks(mode=headless, executor=claude, orchestrator=skill-relay) → 201/200 + 返回 id | curl + python3 解析 |
| A3 | 读回任务 `payload.mode == "headless"` | GET /api/brain/tasks/{id}，python3 断言 |
| A4 | 读回任务 `executor_kind == "relay-container"` | 同上 |
| A5 | PATCH tasks/{id} status=cancelled → 200（清理探针） | curl 检查 HTTP 状态码 |

---

## 产物清单

| 产物 | 路径 |
|------|------|
| smoke 脚本 | `packages/brain/scripts/smoke/headless-smoke.sh` |
| allowlist 登记 | `packages/quality/smoke-allowlist.txt`（追加 `headless-smoke.sh`） |

---

## 约束摘要

- 禁止使用：`jq`、`psql`、`node`
- 探针任务 title：`headless-smoke-probe-test`（区别于真实任务）
- 脚本完成后立即 PATCH cancelled，不留悬挂任务

---

journey_type: quality-smoke
target_environment: local
