# Contract DoD — harness relay executor=codex 兼容层

## [BEHAVIOR] 条目

### [BEHAVIOR] B1 — executor 白名单 + 组合校验
**描述**：POST /api/brain/tasks 必须校验 payload.executor 字段。
- executor 为 null/undefined/缺失 → 允许通过（向后兼容，默认 claude 路径）
- executor = "claude" → 允许
- executor = "codex" + orchestrator = "skill-relay" → 允许
- executor = "codex" + orchestrator ≠ "skill-relay"（或缺失）→ 400，`{"error":"executor=codex requires orchestrator=skill-relay"}`
- executor = 其他任何值（"gemini"、"openai"、""）→ 400，`{"error":"executor must be claude or codex"}`

**测试覆盖**：`tests/contract-executor-validation.test.ts`

---

### [BEHAVIOR] B2 — 双层并发守门 MAX=1
**描述**：spawnSkillRelaySession executor=codex 路径必须执行双层守门。
- 层 1（进程内）：`_activeCodexRelays` 原子计数，> 0 时 defer，不进入 DB 检查
- 层 2（DB）：`SELECT COUNT(*) FROM initiative_runs WHERE orchestrator_host='skill-relay-codex' AND phase NOT IN ('done','failed') AND deadline_at > NOW() AND initiative_id != $self`，> 0 时 defer
- defer 时：返回 `{ok:false, deferred:true, reason:'codex_concurrent_limit'}`，**不递增 task.attempts**，task 保持 queued 状态

**测试覆盖**：`tests/contract-codex-concurrency-gate.test.ts`

---

### [BEHAVIOR] B3 — 额度软闸 defer（team2 quota < 30%）
**描述**：spawnSkillRelaySession executor=codex 路径在守门前检查 team2 5h 窗口额度。
- 查询方式：通过 DB 或 codex CLI `codex usage` 获取 team2 当前用量
- 剩余 < 30% → 返回 `{ok:false, deferred:true, reason:'codex_quota_low'}`，不烧 attempts，task 保持 queued
- 软闸检查失败（查询报错）→ 保守通过（不阻塞 spawn），打 warn 日志

**测试覆盖**：`tests/contract-codex-quota-gate.test.ts`

---

### [BEHAVIOR] B4 — spawn 失败回滚（无 run 行落库 + task 复位）
**描述**：spawnDockerDetached 抛出异常时（容器未起）必须执行完整回滚。
- 打印 `[skill-relay][ALERT]` 级别日志（含 error message）
- UPDATE tasks SET status='queued', claimed_by=NULL, claimed_at=NULL WHERE id=$task_id
- 不插入 initiative_runs 行（无 run 行）
- 返回 `{ok:false, mode:'skill-relay', error:<message>}`

**测试覆盖**：`tests/contract-codex-spawn-failure.test.ts`

---

### [BEHAVIOR] B5 — initiative_runs 落行包含 orchestrator_host + 8h deadline
**描述**：spawnSkillRelaySession executor=codex 成功 spawn 后，initiative_runs 必须落行：
- `orchestrator_host = 'skill-relay-codex'`（区别于 claude 路径的 'skill-relay-session'）
- `deadline_at = NOW() + INTERVAL '8 hours'`（不是 6h）
- `phase = 'A_planning'`
- `orchestrator_version = 'v2'`

**测试覆盖**：`tests/contract-codex-run-row.test.ts`

---

### [BEHAVIOR] B6 — watchdog attempts 上限按 orchestrator_host 分支
**描述**：`resumeStalledRelayRuns` 处理 orchestrator_host='skill-relay-codex' 的 run 时，上限为 2（不是 claude 的 5）。
- orchestrator_host='skill-relay-codex' AND attempts >= 2 → 标 failed，不重点火
- orchestrator_host='skill-relay-session'（claude）AND attempts >= 5 → 标 failed（原逻辑不变）
- watchdog 通过 run 行的 orchestrator_host 字段区分，不查 task.payload.executor

**测试覆盖**：`tests/contract-codex-watchdog.test.ts`

---

### [BEHAVIOR] B7 — entrypoint CECELIA_EXECUTOR=codex 分支 + 退出码真实性
**描述**：entrypoint.sh 在 `CECELIA_EXECUTOR=codex` 时走 codex 执行分支：
- 执行 `codex exec -c approval_policy="never" -c sandbox_mode="danger-full-access" < "$PROMPT_FILE"`
- 用 `PIPESTATUS[0]`（不是 `$?`）取真退出码
- exit=0 但 stdout 含 "401"/"unauthorized"/"usage limit"/"stream error" → 覆写为退出码 1
- callback POST 前对 stdout 尾部 sed 洗 token（`ghp_`/`gho_`/`ghs_`/`github_pat_` 替换为 `***`）
- 日志打 "goal-hook N/A for codex"（不走 CECELIA_GOAL_SETTINGS）

**测试覆盖**：`tests/contract-entrypoint-codex-branch.test.ts`（bash bats 或 vitest shell-exec）

---

### [BEHAVIOR] B8 — 8h 逾期 scanStuckHarness 收尸
**描述**：`scanStuckHarness` 处理 `deadline_at < NOW()` 且 `orchestrator_host='skill-relay-codex'` 的 run 行时：
- `phase` 更新为 `'failed'`
- `failure_reason` 设为 `'relay_deadline_exceeded'`
- 关联 task `status` 更新为 `'failed'`

**测试覆盖**：`tests/contract-codex-stale-cleanup.test.ts`

---

## [RISK] 技术风险登记

| # | 风险描述 | 影响 | 缓解措施 |
|---|---------|------|---------|
| R1 | `@openai/codex` npm 包安装失败 | Docker 镜像 build 失败，无法运行 codex executor | Dockerfile 在 `npm i -g @openai/codex` 后立即执行 `codex --version` 冒烟断言，build 阶段失败可快速暴露；CI 中 A1 断言覆盖 |
| R2 | codex usage 查询 API 不可用（网络故障/权限不足/CLI 版本变更） | 无法获取 team2 5h 窗口额度数据 | B3 已设计 fail-open：查询报错时保守通过（不阻塞 spawn），仅打 warn 日志；不影响主路径 |
| R3 | `CODEX_RELAY_HOME` 环境变量未设置 | Docker 挂载命令行为未定义，`~/.codex-team2` 路径可能缺失 | `harness-skill-relay.js` 需确认是否有默认值逻辑（`process.env.CODEX_RELAY_HOME \|\| path.join(os.homedir(), '.codex-team2')`）；E2E 前置检查目录存在 |

---

## [ARTIFACT] 条目

### A1 — @openai/codex 安装到 Docker 镜像
**路径**：`docker/cecelia-runner/Dockerfile`
**断言**：`RUN npm i -g @openai/codex && codex --version` 新增到 Dockerfile，构建成功，`codex --version` 冒烟输出版本号（非空字符串）。

### A2 — 测试文件落库
**路径**：`sprints/07070902-relay-codex-executor/tests/*.test.ts`
**断言**：至少 7 个测试文件（含 B8 的 contract-codex-stale-cleanup.test.ts），vitest 可识别，Red 阶段均失败（功能未实现前 `npm test` 中至少有这些测试失败）。

### A3 — task-plan.json
**路径**：`sprints/07070902-relay-codex-executor/task-plan.json`
**断言**：合法 JSON，含 `initiative_id` + `tasks[0].id = "ws1"`，`tasks[0].files` 列出 ≥ 5 个受影响文件。

---

## DoD 完成标准

以下条件**全部满足**方可标 DONE：

- [ ] B1–B8 所有 [BEHAVIOR] 单元测试 Green
- [ ] E2E 验收脚本（contract-draft.md ## E2E 验收 块）手动执行通过（local_api）
- [ ] A1：Docker 镜像 build 成功，`docker run --rm cecelia/runner:latest codex --version` 输出版本
- [ ] A2：测试文件存在且覆盖 B1-B7
- [ ] A3：task-plan.json 存在
- [ ] claude 分支现有测试未回退（`npm test` 绿）
- [ ] 无凭据/token 硬编码进代码或日志

---

## manual:bash 可执行验收命令

```bash
# 快速冒烟（Brain 需在 localhost:5221 运行）

# 1. executor 白名单拒绝（期望 400）
curl -s -o /dev/null -w "HTTP %{http_code}\n" -X POST http://localhost:5221/api/brain/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"smoke-test","task_type":"harness_initiative","payload":{"orchestrator":"skill-relay","executor":"invalid"}}'

# 2. codex+非skill-relay 组合拒绝（期望 400）
curl -s -o /dev/null -w "HTTP %{http_code}\n" -X POST http://localhost:5221/api/brain/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"smoke-test","task_type":"harness_initiative","payload":{"orchestrator":"langgraph","executor":"codex"}}'

# 3. 合法 codex 创建（期望 201）
curl -s -X POST http://localhost:5221/api/brain/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"codex relay smoke","task_type":"harness_initiative","payload":{"orchestrator":"skill-relay","executor":"codex","journey_id":"bb8cc561-b3ee-4fec-b74d-2255694bd963"}}' | jq '{id,status,task_type}'

# 4. 查 initiative_runs（替换 <TASK_ID>）
psql postgresql://localhost/cecelia -c \
  "SELECT orchestrator_host, phase, deadline_at FROM initiative_runs WHERE initiative_id='<TASK_ID>' ORDER BY started_at DESC LIMIT 3;"

# 5. 查 Docker 容器（替换 <SHORT8> = task_id 前8位去横线）
docker ps --format "{{.Names}}" | grep "cecelia-relay-<SHORT8>-cx"

# 6. 运行单元测试（Red 前：功能未实现，测试应失败）
cd /workspace && npx vitest run sprints/07070902-relay-codex-executor/tests/ 2>&1 | tail -20
```
