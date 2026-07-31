# Acceptance 内网端点扩展（Staff Hub 直连）设计

> 完整业务背景/Golden Path/判定点见 `sprints/07310949-staff-hub-acceptance/prep-prd.md`。本文档聚焦本仓库（cecelia/Brain）这一侧的技术设计。

## 背景

验收终局决策（fc7b5dc0）：Notion Worker 退场，Staff Hub 直连 Brain。Staff Hub 部署在香港 VPS，Brain 部署在美国机，两地经 Tailscale 私网互通（非公网），因此 Staff Hub 作为"内网客户端"应该调用 `packages/brain/src/routes/acceptance.js` 的**内网 router**（挂 `/api/brain/acceptance`，无 Bearer Token，靠限流防护），而不是为 Notion Worker 设计的公网 5223 Bearer Token router。

内网 router 目前只有 `POST /runs`、`GET /runs/:run_key`、`POST /catalog` 三个端点，缺少 Staff Hub 需要的"列出待验收清单"、"按 GP 查历史"、"提交结果"三个动作——这三个动作目前只存在于公网 router（为 Notion Worker 设计）。

## 架构决策

1. **共享核心逻辑，双重外壳**：`POST /acceptance/results` 的核心业务逻辑（校验 → 事务写入 → 重算 pass_rate/status → 驳回转变沿开任务）抽成一个可复用函数，内网 router 和公网 router 各自的 handler 只负责"怎么鉴权 + 调这个函数"。避免两处维护同一段状态机逻辑产生行为分裂。
2. **新增字段**：
   - `acceptance_checks.detail JSONB` — 工作卡文案（操作步骤/预期结果/判定标准），nullable，向后兼容旧行。
   - `acceptance_checks.submitted_by TEXT` — 记录这条判定项是谁提交的（留痕，非鉴权用途），nullable。
3. **驳回任务去重**：给 `tasks` 表按 `payload->>'acceptance_run_key'` 加一个 partial unique index（仅覆盖未终态状态），配合现有 SELECT-then-INSERT 逻辑在遇到唯一约束冲突（`23505`）时静默转成幂等成功，堵住内网+公网两条 results 路径并发写同一 run 时可能重复开任务的竞态窗口。
4. **不做 assignee/归属校验**：用户已拍板验收是团队共享池模式（多员工多设备协作，同一 run 不同判定项可能由不同人不同时间填），不设"这个 run 分配给谁"的锁定字段，`submitted_by` 只做留痕不做权限判断。

## 新增端点

### `GET /api/brain/acceptance/pending`
返回所有非终态（`pending`/`in_review`）的 run，附带每个 run 的判定项统计（total/pass/fail/pending 计数），供 Staff Hub 首页角标和列表页使用。

### `GET /api/brain/acceptance/runs?gp_id=<id>`
按 `gp_id` 过滤，返回该 GP 的历史所有 run（含终态），按 `version`/`created_at` 排序，每条 run 附带其判定项列表（含 result/note/decided_at），供 Staff Hub 历史页使用。

### `POST /api/brain/acceptance/results`（内网版）
请求体与公网版一致（`{ results: [{ check_key, result, note }] }`），额外接受可选 `submitted_by` 字段透传写入。复用第 1 条架构决策里抽取的共享核心函数。

## 测试策略

- 单元测试：`detail`/`submitted_by` 读写、`GET pending` 过滤非终态、`GET runs?gp_id=` 排序正确性
- 集成测试（真实 Postgres）：并发提交同一 run 不同 check 触发两次 failed 转变沿 → 断言最终只有一条 `[验收驳回]` 任务（proven-to-fire：先复现两条，再验证 partial unique index 修复后只剩一条）
- 复用/扩展现有 `acceptance-endpoints-smoke.sh`

## 不包含

- staffGuard 鉴权模型升级（另开 Issue）
- Staff Hub 前端实现（zenithjoy-workspace 仓库另一 PR，依赖本 PR 先合并）
