# Smoke Runtime Tests — PR 1/3 Design

**Goal:** 为 Cecelia Brain 的 27 个 feature（health 5 + admin 6 + agent 5 + tick 11）创建真实行为验证脚本 `packages/brain/scripts/smoke/smoke-runtime.sh`，每个 feature 对应真实 API 端点调用 + 响应字段断言。

**Architecture:** 独立 bash 脚本，完全仿照 `cecelia-smoke-audit.sh` 风格（ok/fail/section 计数器，最终 exit 0/1）。不是 `all-features-smoke.sh`（DB 驱动动态执行器），是固定断言的静态脚本。

**Tech Stack:** bash + curl + jq，依赖运行中的 Brain (localhost:5221)。

---

## 端点断言清单

### health (5 个 feature)
| feature | 端点 | 断言 |
|---------|------|------|
| brain-health | GET /api/brain/health | `.status == "healthy"` |
| brain-status | GET /api/brain/status | `.generated_at != null` |
| circuit-breaker | GET /api/brain/health | `.organs.circuit_breaker != null` |
| brain-status-full | GET /api/brain/status/full | `.nightly_orchestrator != null` |
| circuit-breaker-reset | GET /api/brain/health | `.organs != null` + HTTP 200 |

### admin (6 个 feature)
| feature | 端点 | 断言 |
|---------|------|------|
| llm-caller | GET /api/brain/health | `.organs != null` |
| area-slot-config | GET /api/brain/capacity-budget | `.areas != null` |
| model-profile | GET /api/brain/model-profiles | `.profiles != null` |
| skills-registry | GET /api/brain/capabilities | `.count != null` |
| task-type-config | GET /api/brain/task-types | `.task_types != null` |
| device-lock | GET /api/brain/device-locks | `.success == true` |

### agent (5 个 feature)
| feature | 端点 | 断言 |
|---------|------|------|
| agent-execution | GET /api/brain/tasks?status=in_progress&limit=1 | `type == "array"` |
| executor-status | GET /api/brain/health | `.organs.planner != null` |
| cluster-status | GET /api/brain/cluster/scan-sessions | `.processes != null` |
| session-scan | GET /api/brain/cluster/scan-sessions | `.scanned_at != null` |
| session-kill | POST /api/brain/cluster/kill-session {pid:0} | `has("error") or has("success")` |

### tick (11 个 feature)
| feature | 端点 | 断言 |
|---------|------|------|
| self-drive | GET /api/brain/tick/status | `.enabled != null` |
| tick-loop | GET /api/brain/tick/status | `.loop_running != null` |
| tick-cleanup-zombie | GET /api/brain/tick/status | `.last_cleanup != null // true` |
| recurring-tasks | GET /api/brain/recurring-tasks | `type == "array"` |
| tick-disable | POST /api/brain/tick/disable (→ re-enable) | `.success == true` |
| tick-enable | POST /api/brain/tick/enable | `.success == true` + `.enabled == true` |
| tick-drain | POST /api/brain/tick/drain (→ drain-cancel) | `.success == true` |
| tick-drain-cancel | POST /api/brain/tick/drain-cancel | `.success == true` |
| tick-drain-status | GET /api/brain/tick/drain-status | `has("draining")` |
| tick-execute | POST /api/brain/tick | `.success == true` |
| tick-startup-errors | GET /api/brain/tick/startup-errors | `has("errors")` |

---

## 幂等性规则

- `tick-disable` 测试后立即 POST /tick/enable 恢复
- `tick-drain` 测试后立即 POST /tick/drain-cancel 恢复
- `tick-execute` 触发一次 tick，结果不影响系统状态

---

## 测试策略

- 脚本本身是 E2E smoke test（真 Brain 环境执行）
- TDD：先写 `packages/brain/src/__tests__/smoke-runtime.test.js`（验证文件存在 + 可执行 + 格式正确），再实现 .sh 脚本
- CI `real-env-smoke` job 执行 `packages/brain/scripts/smoke/*.sh`
- 成功标准：FAIL==0 → exit 0；FAIL>0 → exit 1；无 DB writeback

---

## 与现有脚本的关系

| 脚本 | 类型 | 用途 |
|------|------|------|
| cecelia-smoke-audit.sh | 固定断言 | 覆盖 immune/alertness/cluster/schedule/operation 17 个 feature |
| smoke-runtime.sh (新) | 固定断言 | 覆盖 health/admin/agent/tick 27 个 feature |
| all-features-smoke.sh | 动态 DB 驱动 | 跑所有 feature 的 smoke_cmd 并写回 smoke_status |
