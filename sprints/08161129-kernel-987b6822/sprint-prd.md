# Sprint PRD — 有头 /dev 收编：Work Router receipt 有头签发口

## OKR 对齐

- **对应 KR**：KR-Cecelia基础稳固（系统可信赖、算力全开、管家闭环）
- **当前进度**：82%
- **本次推进预期**：+2%（补上有头会话进 harness 同闸门的 bootstrap 逃生口，解 fail-closed 死锁）

## 背景

#4872/#4896 起 `dev-mode-tool-guard.sh` 对除 Read/Grep/Glob/WebFetch/WebSearch 外所有工具 fail-closed：需 `.dev-lock.<branch>`
含 routing_receipt_id/task_id/run_id/repo/base_sha 且 `POST /api/brain/work-routing/validate` 返回 `valid:true`；validate 要求
receipt 绑定一条 status∈(starting,running) 的 harness_attempts 行且 branch 为 `cp-*`。但 Brain 无**有头签发口**，launcher 落的
`session-xxx` worktree 里连 `echo` 都 route_violation，连想修这个闸也无法 /dev——「fail-closed 无 bootstrap 逃生口」死锁应验。
本 sprint 补的是**签发口**（有头拿 receipt），不是放行口（闸门语义不放松）。

## Golden Path（核心场景）

有头会话从 [origin/main 起新 worktree] → 经过 [/dev 签发 headed attempt + 收编分支] → 到达 [同闸门放行普通工具]。

具体：
1. 有头会话在 `origin/main` 起新 session worktree，执行 `/dev --task-id <已路由任务>`。
2. `worktree-manage.sh init-or-check|create` 检测到 `--task-id` → 调 `POST /api/brain/work-routing/headed-attempts`
   （入参 task_id + branch(cp-*) + base_sha + session 标识）。
3. Brain 校验 task 有 `routing_receipt_id` → 复用或按 kernel 规则创建 `initiative_run`（controller identity 走现有
   `createKernelRun` 不变量）→ 写一条 `harness_attempts`（role 取既有合法枚举、attempt_kind 标 headed、status=running、
   `task_bundle.inputs.workspace_spec={branch,base_sha}`、生成 callback_secret 仅返回一次）→ 返回
   `{routing_receipt_id, run_id, base_sha, route_token}`。
4. worktree 分支自动改名 `cp-<MMDDHHNN>-<slug>`（session-* 不能过 validate），把返回值写进 `.dev-lock.<branch>`
   六字段并导出 `CECELIA_ROUTING_VALIDATE_URL` / `CECELIA_ROUTING_VALIDATION_TOKEN` 等 env。
5. 会话内执行 `echo ok`（非只读工具）→ hook 读 lock → `POST /work-routing/validate` 带 token+branch+base_sha
   返回 `valid:true` → hook 放行（返回非 block）；不带 --task-id 起的 session-* 会话仍 route_violation。
6. bootstrap 逃生口：当且仅当命令是 `bash <repo>/packages/engine/skills/dev/scripts/worktree-manage.sh …`
   （精确路径匹配）且当前无 lock 时，hook 放行让 /dev 能拿到 receipt；其它一切照旧 fail-closed。
7. 出口：/dev 收尾或 PR merged 时 `PATCH` attempt → completed，validate 随之返回 `run_attempt_inactive`（闸自动收回）。

<!-- Response Schema 由 Proposer 在 Step 1.1 读 api_registry 后推导。 -->
## 边界情况

- task 无 `routing_receipt_id` → headed-attempts 返回 400（不签发）。
- attempt 已 completed 后再 validate → 409 / `run_attempt_inactive`（闸收回）。
- lease/heartbeat 超时未续 → attempt 自动 expire → validate 返回 `run_attempt_inactive`。
- 分支非 `cp-*`（如 session-*）→ validate 恒 false，无法放行。
- 无 lock 且命令非 worktree-manage.sh 精确路径 → 仍 route_violation（逃生口不泛化）。
## 范围限定

**在范围内**：Brain 新增有头签发口 headed-attempts；worktree-manage.sh 有 --task-id 时取 receipt 写 lock+改 cp 分支；
hook 加唯一 worktree-manage.sh 精确路径 bootstrap 逃生口；attempt 结束 PATCH completed 使 validate 失效。
**不在范围内**：不恢复 skill-relay 有头入口；不给 hook 加任何按命令内容判读写的白名单；不改 validate 的 SQL 语义；
不放松 hook 对普通工具的 fail-closed 语义。

## 假设

- [ASSUMPTION: headed attempt 的 role 取 harness_attempts 既有合法枚举内值（如 headed_dev 若合法，否则复用现成 dev 类角色），不新增数据库枚举迁移。]
- [ASSUMPTION: lease/heartbeat 直接复用现有 attempt 心跳与 expire 机制，不新建独立租约表。]
- [ASSUMPTION: 合同冻结测试放 sprints/08161129-kernel-987b6822/tests/（r2 硬要求）；永久回归由 Generator 复制进 packages/brain/src/**/__tests__/。]

## 预期受影响文件

- `packages/brain/src/routes/work-routing.js`：新增 `POST /api/brain/work-routing/headed-attempts` 签发口；attempt completed→validate 失效路径。
- `packages/engine/skills/dev/scripts/worktree-manage.sh`：`init-or-check`/`create` 有 --task-id 时调签发口、写 lock 六字段、改 cp-<MMDDHHNN>-<slug> 分支、导出 validate env。
- `packages/engine/hooks/dev-mode-tool-guard.sh`：新增 worktree-manage.sh 精确路径 bootstrap 逃生口（无 lock 时）；含 [CONFIG] title / 版本 bump / feature-registry changelog 三要素。
- `packages/brain/package.json` 及 semver 四处同步：Brain 版本 bump（当前 1.273.59）。
- `packages/engine/tests/integration/dev-mode-tool-guard.test.sh`：扩展逃生口 + 仍 block 断言（Generator 阶段落地）。

## NFR 约束

<!-- 来源: decisions 表 category=nfr 空；下列来自 PrepPRD 显式约束 -->
- 超时/租约: lease/heartbeat 复用 attempt 心跳，超时自动 expire → validate 返回 `run_attempt_inactive`。
- 凭据: callback_secret 生成后仅返回一次；callback_secret_hash 落库供 validate 比对。
- 分支约束: 签发分支必须 `cp-*`；session-* 不得过 validate。
- 版本要求: Brain semver bump 四处同步 + DevGate；Engine hook 改动三要素（[CONFIG] title / 版本 bump / feature-registry changelog）。
- 可观测: headed attempt 落 harness_attempts 行，psql 可查 headed 行与 status。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: 本 sprint 决策(task 决策/不做段) + area 级系统铁律 -->
- [同闸门] 有头无头共用同一闸门 c3617bdf 不变；本 sprint 补签发口不是放行口，hook 对普通工具语义不放松（来源: journey_feature）
- [不改validate] 不改 validate 的 SQL 语义（来源: journey_feature）
- [逃生口唯一] hook 只加 worktree-manage.sh 精确路径 bootstrap 逃生口，禁止任何按命令内容判读写的白名单（来源: journey_feature）
- [planner分支] planner 使用服务端签发的 PLANNER_BRANCH，禁止 Provider 内自行 checkout/switch（来源: area）
- [合同产物路径] 合同冻结测试必须落 sprints/<sprint_dir>/tests/，kernel 只采集此路径（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
- （本 line 暂无已验收行为——golden-paths 仅含 planned 态 ability，无 done/working 历史）

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 产出（curl localhost:5221 + psql）。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本（curl + psql）
# 期望验收点（自然语言）：
# 1. 对无 routing_receipt_id 的 task 调 headed-attempts → 400。
# 2. 对已路由 task 调 headed-attempts → 返回 route_token；psql 查 harness_attempts 新行 status=running、
#    workspace_spec.branch/base_sha 正确、attempt_kind=headed。
# 3. 带该 token+branch(cp-*)+base_sha 调 /work-routing/validate → valid:true。
# 4. PATCH attempt completed 后再 validate → 409 / run_attempt_inactive。
# 5. dev-mode-tool-guard.test.sh：无 lock 时 worktree-manage.sh 放行、其它 Bash block；有 lock 但 validate 返回 run_attempt_inactive → block。
# 6. .dev-lock.<cp-branch> 六字段 jq 校验齐全（routing_receipt_id/task_id/run_id/repo/base_sha + token）。
```

## journey_type: dev_pipeline
## journey_type_reason: 主改 packages/engine hooks/skills（dev-mode-tool-guard.sh、worktree-manage.sh）打通 /dev harness 收编管道，属开发流水线。
## target_environment: local_api
## target_environment_reason: payload 显式 target_environment=local_api；验收为 Brain API 签发/validate + psql 查 harness_attempts，本地 evaluator curl localhost:5221 即可。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
