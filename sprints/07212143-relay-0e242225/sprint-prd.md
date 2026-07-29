# Sprint PRD — headless dispatch chain smoke（task 0e242225）

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环（82%）
- **当前进度**：82%
- **本次推进预期**：为 mode=headless 派发路径补专项 smoke，与 headed 路径形成对称验收

## 背景

Brain 当前有 headed（ssh+tmux）和 headless（docker relay 容器）两条 dispatch 路径。headed smoke（a85e0582、4bb31ef5、57e25e92）已完整，headless 路径缺专项 smoke 验收。本 sprint 补齐 `executor=claude + mode=headless + orchestrator=skill-relay` 的 dispatch chain 验证脚本。task payload 中无 thin_prd，scope 以 title=headless-smoke + payload 三元组锚定。

## Golden Path（核心场景）

Brain 接收 headless harness_initiative → docker relay 容器正确 spawn → initiative_runs 落行 → e2e-verify.sh 验证关键观测信号

具体：
1. [触发条件] POST tasks（executor=claude, mode=headless, orchestrator=skill-relay）→ Brain 校验 mode 白名单通过，返回 task id
2. [系统处理] tick spawnSkillRelaySession → 非 headed 分支：docker 去重守卫通过 → spawnDockerDetached 启动 `cecelia-relay-<short>` 容器，initiative_runs 落行 orchestrator_host=`skill-relay-session`，phase=`A_planning`
3. [可观测结果] GET /api/brain/tasks/0e242225... 返回 task，payload 含 mode=headless；DB initiative_runs 中 initiative_id=0e242225... 存在合法记录；mode=invalid → 400 拦截正常工作

## 边界情况

- mode=invalid（如 turbo）→ Brain 返回 400，不创建任务
- docker ps 失败 → fail-open 保守放行 spawn（不能让 docker 抽风挡住正常调度）
- initiative_runs 记录 phase=failed → smoke 标 FAIL，不静默跳过
- task payload 意外携带 token/github_token/anthropic_token 明文字段 → FAIL（敏感字段泄漏）

## 范围限定

**在范围内**：
- 新增 `packages/brain/scripts/smoke/claude-headless-dispatch-smoke.sh`，专项验证 mode=headless dispatch 路径
- 新增 `sprints/07212143-relay-0e242225/e2e-verify.sh`，锚定 TASK_ID=0e242225-151d-4bea-a920-9ea51d803269 的回归验证
- 在 `packages/quality/smoke-allowlist.txt` 登记新 smoke 脚本
- 验证 POST tasks(mode=headless) → 200/201；POST tasks(mode=invalid) → 400；initiative_runs 字段正确落行

**不在范围内**：不改 headed 路径；不新增业务功能；不改 dashboard/UI；不改 migrations；不跨 repo promote

## 假设

- [ASSUMPTION: 本次 task 已由 Brain 以 mode=headless/executor=claude/orchestrator=skill-relay 派发，initiative_runs 中存在至少一条记录]
- [ASSUMPTION: docker relay 容器可能已在跑（去重守卫命中），e2e-verify.sh 只验状态，不重复 spawn]

## 预期受影响文件

- `packages/brain/scripts/smoke/claude-headless-dispatch-smoke.sh`：新增，headless dispatch 专项 smoke
- `sprints/07212143-relay-0e242225/e2e-verify.sh`：新增，锚定本次 task_id 的回归验证脚本
- `packages/quality/smoke-allowlist.txt`：登记新 smoke 脚本

## NFR 约束

<!-- 来源: golden-path-decisions?category=nfr 返回空数组；PrepPRD 无显式 NFR 值 -->
- 超时/延迟: smoke 脚本单次运行 ≤30s（无长耗时依赖）
- 频控: 无（只读校验 + 一次性 POST 测试任务，不产生生产副作用）
- 版本要求: 无
- 可观测: smoke 断言失败必须打印明确 FAIL 原因并 exit 1；secrets 不硬编码

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级三源合并去重（step/feature 均为空，area 49 条取 smoke/dispatch/harness 相关关键条） -->
- [单slot串行] 单 slot 内严格串行执行任务，前一个收口才起下一个（来源: area）
- [禁写死假设] 端口、路径、ssh host、凭据目录等优先读取 payload/env，禁止写死（来源: area）
- [真验才done] 未实际验证 Brain API/DB 信号前不能标 done（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [日志脱敏] PII/客户隐私/token 不得明文进日志（来源: area）
- [feat+brain/src PR] 开 PR 前直接一次带齐 smoke.sh + smoke-allowlist 登记（来源: area）
- [服务判活] 服务存活判定使用双信号（launchctl 状态 + 端口监听）（来源: area）
- [新task接线] 新 task_type 接线覆盖约束/路由表/executor 分支/relay loadSkill（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: journeys/golden-paths 查询：journey_id 为空（本任务 payload 无 journey_id），优雅降级 -->
（本 line 暂无历史）

## E2E 验收

期望验收点（自然语言）：
1. GET /api/brain/tasks/0e242225-151d-4bea-a920-9ea51d803269 返回 task，payload.mode=headless / payload.executor=claude / payload.orchestrator=skill-relay，且 payload 不含 token/github_token/anthropic_token 明文字段
2. DB initiative_runs 中 initiative_id=0e242225-151d-4bea-a920-9ea51d803269 至少一条记录，orchestrator_host=skill-relay-session，phase 非 failed
3. POST tasks(mode=headless, executor=claude) → 200/201；POST tasks(mode=invalid) → 400
4. initiative_runs 表含 tmux_killed_at 字段（migration 316 已跑）
5. 新 smoke 脚本已在 packages/quality/smoke-allowlist.txt 登记

```bash
# 占位：proposer 按 target_environment=local_api 填入真实脚本（curl localhost:5221 + psql）
```

## journey_type: autonomous
## journey_type_reason: 纯 Brain 后端 headless docker relay dispatch 路径 smoke，无用户可见 UI 交互
## target_environment: local_api
## target_environment_reason: 验收信号来自本地 Brain API localhost:5221 与本地 PostgreSQL，无需浏览器或远端 runner
## journey_id: none
## step_id: none（PrepPRD 未锚定）
