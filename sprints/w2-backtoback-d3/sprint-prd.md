# Sprint PRD — 背靠背服务端裁剪 + 三 token 分权（D3）

task_id: 0b7df1ca-da50-4928-9d24-bfbb8ae7cd90
sprint_dir: sprints/w2-backtoback-d3
journey_type: autonomous
target_environment: local_api

---

## 真机边界声明

本 sprint 不涉及任何真机、android、移动设备。验收动作全部通过 curl + psql 在本地完成，零真机动作。theater 闸已语境化（决策 `457ab116`）。

---

## FR（本 sprint 交付）

| # | 文件 | 变更描述 |
|---|------|---------|
| FR-1 | `routes/acceptance.js` · `loadChecks` | SELECT 显式列，排除 AI 四列；`view=review` + `human_complete` 时才包含 |
| FR-2 | `routes/acceptance.js` · `loadRunsWithChecks` | SELECT 显式列；gp 级跨轮闸：存在活跃 run（`status IN ('pending','in_review')`）则全部 run AI 四列 + `adjudication` 置空 |
| FR-3 | `routes/acceptance.js` · `GET /runs/:run_key` | 默认态剥 AI 四列；`?view=review` 须 `status == 'human_complete'` 否则 403 |
| FR-4 | `routes/acceptance.js` · 内网 `GET /acceptance/pending` | `loadPendingRuns` 结果剥 AI 四列 |
| FR-5 | `acceptance-public-server.js` | `createBearerAuth` 从 app 级移到路由级；公网 `POST /acceptance/results` 与 `GET /acceptance/pending` 解挂路由（不删函数体） |
| FR-6 | `acceptance-public-server.js` | 三 token 路由级分权：AI token → `POST /acceptance/ai-results`；gate token → `GET /acceptance/gate`；api token → `GET /acceptance/catalog`；token 缺失 → 不挂载 + 启动告警，不崩 |
| FR-7 | `routes/acceptance.js` · `POST /acceptance/ai-results` | 校验该路由受 `ACCEPTANCE_AI_TOKEN` 守卫；`result`/`submitted_by` 字段服务端过滤不写 DB |
| FR-8 | `__tests__/acceptance-d3-backtoback.test.js` | failing test 先入库：读侧 9 出口 + 反向断言 2 组 + 写侧 3 条（≥14 断言） |
| FR-9 | `brain-ci.yml` | 确认 `acceptance-d3-backtoback.test.js` 在 CI 覆盖范围内 |

---

## NFR 约束

- **NFR-1 安全·默认隐藏**：所有读侧端点默认响应不含 AI 四列；字段遗漏视为 P0。
- **NFR-2 安全·token 零崩**：任意单个 token 缺失，listener 必须正常启动，缺失端点不挂载。
- **NFR-3 性能**：列白名单改造不增加额外 JOIN，P99 延迟增量 < 5ms。
- **NFR-4 可观测性**：token 缺失时启动日志打印告警；端点解挂时打印休眠日志。
- **NFR-5 不删码**：公网端点函数体保留，只解挂路由注册（决策 `fc7b5dc0` 休眠语义）。
- **NFR-6 向后兼容**：内网 5221 `POST /acceptance/results` 行为不变；内网 `GET /acceptance/pending` 只清 AI 列。
- **NFR-7 回归保护**：新测试文件必须入 CI 回归，永久留存。

---

## 累积 FR（D1 已验收，本 sprint 不得回退）

- `acceptance_checks` 表含 `ai_verdict`/`ai_evidence`/`ai_run_at` 三列（migration 392）
- `acceptance_runs.status` CHECK 含 7 值状态机：`pending`/`in_review`/`human_complete`/`adjudicated`/`stale`/`expired`/`abandoned`
- `acceptance.js:88` 三元式已替换为 `computeRunStatus`（`passed`/`failed` 退为历史兼容只读值）
- `POST /acceptance/ai-results` 端点已存在，只吃 `ai_verdict`/`ai_evidence`/`ai_run_at`，`reason` 与静态属性服务端校验已实现
- `reason='scenario_not_triggered'`（任何格）→ 400 拒收
- `UNIQUE (run_id, check_key)` 替换全局 UNIQUE；`submitAcceptanceResults` 全链路带 `run_id` 作用域

---

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant（area 级），step + GP decisions，安全铁律 -->

- **[SQL列白名单默认隐藏]** 服务端读取路径默认不返回 AI 四列（`ai_verdict`/`ai_evidence`/`ai_run_at`/`adjudication`），必须显式传 `view=review` 且 run 已达 `human_complete` 才解锁；新增列不得绕过白名单自动泄露（J6 判据，决策 `fdeb48aa` ②）
- **[gp级跨轮闸活跃run谓词]** 跨轮 AI 列隐藏的判据必须用 `status IN ('pending','in_review')` 口径（与 `loadPendingRuns` 同款），不得用宽泛的「存在 run」判据（r4-P1-1，J2 判据②）
- **[createBearerAuth容错]** token 参数为空时不得 throw，改为该路由不挂载 + 启动告警；三把钥匙任一缺失只降级该端点，不拖挂 listener（P2-19，决策 `fc7b5dc0`）
- **[公网端点休眠不删码]** 解挂路由实现为不注册 `app.use('/acceptance/results', ...)` 而非删函数体（决策 `fc7b5dc0` 休眠语义）
- **[上线前核日志]** `POST /acceptance/results` 与 `GET /acceptance/pending` 下线前必须核查 5223 近 30 天访问日志；若发现非预期活跃调用方，改走候选 B 并回报，不得跳过
- **[AI token 不得持有人列写权]** `ACCEPTANCE_AI_TOKEN` 所对应的路由必须只挂 `POST /acceptance/ai-results`（决策 `fdeb48aa` ②，r2-P0-3）
- **[写侧过滤]** `POST /acceptance/ai-results` handler 收到 `result`/`submitted_by`/`adjudication` 字段时，服务端必须静默忽略，不写 DB（J19 三 token 分权落法表）
- **[端点鉴权]** 每个 API 端点必须有 auth，无鉴权端点不准 ship（来源: area, id=50954d28）
- **[凭据安全]** secrets 不硬编码、不进 git、不进日志（来源: area, id=564802ee）
- **[租户隔离]** 碰租户数据的查询/写入必须 scope 到当前租户（来源: area, id=68976b17）
- **[failing test 先 commit]** FR-8 的 failing tests 必须在修复代码 commit 之前独立入库（来源: CLAUDE.md Bug Fix 流程）
- **[proposer起草涉及DB字段的合同前先psql核对]** 合同中列出的字段名必须先 `\d acceptance_checks` / `\d acceptance_runs` 核对真实列名（来源: area, id=e6513dff）

---

## journey_type: autonomous
## journey_type_reason: 纯服务端 Brain API 改造，无用户可见 UI 交互；验收通过 curl localhost:5221 + psql 完成
## target_environment: local_api
## target_environment_reason: 验收信号来自本地 Brain API localhost:5221 与本地 PostgreSQL 查询，无需浏览器或远端 runner
## journey_id: 2fa4d085-1451-4f3f-8fa1-b6d4bacdb1b6
## step_id: 817f59f5-02ff-4a70-bd81-f7ae65f77e02
## gp_id: 7790f728-f490-4243-b166-03f3250a0938
