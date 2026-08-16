# Sprint PRD — 有头 /dev 收编：Work Router receipt 有头签发口

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：+2%（补齐 fail-closed 闸的 bootstrap 逃生口，恢复有头 /dev 自修复能力）

## 背景

#4872/#4896 起 `dev-mode-tool-guard.sh` 对除 Read/Grep/Glob/WebFetch/WebSearch 外的所有工具（含 Bash/Edit/Write）要求 `.dev-lock.<branch>` 六字段齐全且 `POST /work-routing/validate` 返回 `valid:true`。而 Brain 没有任何**有头签发口**：launcher 落的新 session worktree（分支 `session-xxx`）拿不到 receipt，连 `echo` 都 `route_violation`，连"修这个闸"都无法 /dev（设计评审预警的"fail-closed 自修复死锁无 bootstrap 逃生口"应验）。决策 c3617bdf 不变——**有头无头同闸门**，本 sprint 补的是签发口（让有头拿到合法 receipt），不是放行口（不放松闸语义）。

## Golden Path（核心场景）

有头会话在新 session worktree [入口] → 经 /dev 换 cp-branch 并向 Brain 领有头 attempt 拿 receipt [关键步骤] → `echo ok` 通过 hook、可正常编码 [出口]

具体：
1. 用户在新 session worktree 跑 `/dev --task-id <已路由 task>`。此时无 lock，hook 仅对 `bash <repo>/packages/engine/skills/dev/scripts/worktree-manage.sh …`（精确路径匹配）放行，其余 Bash 仍 block。
2. worktree-manage.sh（init-or-check / create）见 `--task-id` → 把分支从 `session-*` 改为 `cp-<MMDDHHNN>-<slug>`（session-* 过不了 validate 的 `cp-*` 约束）→ 调 `POST /api/brain/work-routing/headed-attempts`，入参 `task_id + branch(cp-*) + base_sha + session 标识`。
3. Brain 校验 task 有 `routing_receipt_id`（无则 400）→ 按 kernel 规则创建或复用 `initiative_run`（controller identity 走现有 `createKernelRun` 不变量）→ 写一条 `harness_attempts`（role 取枚举内合法值如 `headed_dev`、attempt_kind 标 headed、status=running、`task_bundle.inputs.workspace_spec={branch,base_sha}`、生成 callback_secret 只返回一次）→ 返回 `{routing_receipt_id, run_id, base_sha, route_token}`。
4. worktree-manage.sh 把六字段（routing_receipt_id/task_id/run_id/repo/base_sha/branch）写进 `.dev-lock.<cp-branch>`，导出 `CECELIA_ROUTING_VALIDATE_URL` / `CECELIA_ROUTING_VALIDATION_TOKEN`（= route_token）等 env。
5. 之后 `echo ok`（Bash）→ hook 读 lock/env → `POST /validate` 带 token+branch+base_sha → `valid:true` → 放行；不带 task 的裸 session worktree 仍 `route_violation`（可观测结果）。
6. /dev 收尾或 PR merged → `PATCH attempt completed` → attempt 不再 status∈(starting,running) → validate 返回 `run_attempt_inactive`，闸自动收回。lease/heartbeat 复用现有 attempt 心跳，超时自动 expire 同样收回。

## 边界情况

- task 无 `routing_receipt_id` → headed-attempts 返回 400，不写库。
- attempt 已 completed / expire 后再校验 → validate 返回 409 `run_attempt_inactive`（block）。
- 分支非 `cp-*`（session-* 未改名）→ validate 的 BRANCH 正则拒绝，闸不放行。
- 同一 task 重复领 attempt → 复用 initiative_run，不裂变新 run（createKernelRun 幂等不变量）。
- Brain 不可达 → headed-attempts 调用失败，/dev 无法拿 receipt，闸保持 fail-closed（不假放行）。

## 范围限定

**在范围内**：Brain 新增 `POST /api/brain/work-routing/headed-attempts`（或等价 `/tasks/:id/claim` 扩展）；attempt 结束 PATCH completed；Engine `worktree-manage.sh` 有 `--task-id` 时调签发口 + 写 lock + 改 cp-branch；Hook 补 worktree-manage.sh 精确路径 bootstrap 逃生口；三处 [BEHAVIOR] 测试 + Final E2E。

**不在范围内**：不恢复 skill-relay 有头入口；不给 hook 加任何"按命令内容判读写"的白名单（只放行 worktree-manage.sh 精确路径）；不改 validate 的 SQL 语义；不放松同闸门决策 c3617bdf。

## 假设

- [ASSUMPTION] route_token 即 attempt 的 callback_secret 明文，`callback_secret_hash` 存 sha256(route_token)，validate 的 `$7` 参数按此 hash 比对（沿用现有 validate SQL 第 72 行语义，不改 SQL）。
- [ASSUMPTION] harness_attempts.role 枚举含可复用的 headed 合法值；若无则在既有枚举内取语义最近值并在 attempt_kind='headed' 上做区分，不新增枚举（避免 CHECK 约束漂移）。
- [ASSUMPTION] session 标识由 launcher 的 `$CLAUDE_SESSION_ID` 提供，写入 attempt 便于收尾 PATCH 定位。

## 预期受影响文件

- `packages/brain/src/routes/work-routing.js`: 新增 headed-attempts 签发 handler（validate SQL 语义不动）。
- `packages/brain/src/harness-skill-relay.js`（或 createKernelRun 所在模块）: 复用 kernel run 创建/复用不变量。
- `packages/brain/package.json` 等四处: semver bump 同步。
- `packages/engine/skills/dev/scripts/worktree-manage.sh`: init-or-check/create 加 `--task-id` 分支 → 调签发口、改 cp-branch、写六字段 lock、导出 env。
- `packages/engine/hooks/dev-mode-tool-guard.sh`: 补 worktree-manage.sh 精确路径 bootstrap 逃生口（无 lock 时放行该命令）。
- `packages/engine/tests/integration/dev-mode-tool-guard.test.sh`: 新增 bootstrap 放行 + run_attempt_inactive block 断言。
- Brain 单测（headed-attempts + validate 联动）、feature-registry changelog（hook [CONFIG] 三要素）。

## NFR 约束

<!-- 来源: decisions category=nfr（step+feature 均空数组）+ 任务本体约束 -->
- 超时/延迟：validate 调用 `--max-time 5`（沿用 hook 现值，不改）；attempt lease 超时自动 expire（复用现有心跳）。
- 频控：无新增。
- 版本要求：Brain 改动必须 semver bump 四处同步 + 过 DevGate（facts-check / version-sync / dod-mapping）；Engine hook 改动三要素（[CONFIG] title / 版本 bump / feature-registry changelog）。
- 可观测：headed attempt 落 `harness_attempts` 真实行（psql 可查 headed 行）；失败路径 fail-closed，不假放行。
- 凭据：route_token/callback_secret 只在签发时返回一次，库内只存 hash，不入 git、不落日志明文。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级（step/feature 源本 sprint 为空）；仅注入与本 sprint 强相关铁律 -->
- [同闸门] 有头无头共用 dev-mode-tool-guard receipt 闸，签发口不得放松闸语义（来源: 任务决策 c3617bdf）
- [端点鉴权] 新增 Brain 端点必须走既有鉴权（internal token / route token），不得裸开（来源: area [系统]端点鉴权）
- [禁写死环境] 禁止写死环境假设值（端口/URL/base_sha 走 env 与 payload）（来源: area [系统]禁止写死环境假设值）
- [真环境验证] 真环境验证才算 done（psql 查 harness_attempts headed 行 + hook 真返回非 block）（来源: area [系统]真环境验证才算 done）
- [planner_role_branch] planner 绑定服务端签发的 role 分支，禁止自行 checkout/switch（来源: area planner_role_branch）
- [headed worktree_path] headed 前台点火任务须在点火时用 Brain 同款 jsonb merge 把 worktree_path 写进 task payload（来源: area 17722a93）
- [headed base_repo] headed 点火须把 base_repo 或 pr_url 写入 task payload、分支名带 task short id（来源: area 37e0d7c9）
- [session env 不继承] tmux 子 shell 不自动继承父环境变量，需 Claude session 内用的 env 必须显式导出（来源: area 72890f7c）
- [租户隔离] 测试默认多租户、记忆/资源按租户隔离（来源: area [系统]租户隔离）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
- （本 line 暂无历史：journey e6f803f2 下 ability 仅 status=planned，无 done/working 已验收行为）

## E2E 验收

> 本区块 Planner 留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（curl localhost:5221 + psql）。

```bash
# 占位：proposer 按 target_environment=local_api 填入真实脚本（curl+psql）
# 期望验收点（自然语言）：
# 1) 从 origin/main 起新 session worktree，不带 task 时任意 Bash（echo）被 hook block（route_violation）。
# 2) 走 /dev --task-id <已路由 task>：worktree-manage.sh 被 hook 放行、领到 attempt、改 cp-branch、写六字段 lock（jq 校验齐全）。
# 3) 此后 `echo ok` 通过 hook（hook 返回非 block）。
# 4) psql 查 harness_attempts 存在该 run 的 headed 行、status=running、workspace_spec.branch/base_sha 正确。
# 5) PATCH attempt completed 后再 validate → 409 run_attempt_inactive（echo 重新被 block）。
```

## journey_type: dev_pipeline
## journey_type_reason: 核心改动落在 packages/engine/hooks（dev-mode-tool-guard.sh）与 skills/dev/scripts（worktree-manage.sh），属开发流水线闸门修复
## target_environment: local_api
## target_environment_reason: payload 显式指定 local_api；验收走本地 curl localhost:5221 + psql 查 harness_attempts（Brain 内部/后端签发口）
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
