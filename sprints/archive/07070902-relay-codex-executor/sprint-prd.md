# Sprint PRD — harness relay executor=codex 兼容层

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环（82%）
- **当前进度**：82%
- **本次推进预期**：+3%（新增 codex executor 路径，harness one-session 模式解耦 Claude Code 绑定）

## 背景

harness skill-relay 当前仅支持 executor=claude（Claude Code CLI）。本 sprint 新增 executor=codex 分支，让同一 worktree/callback/watchdog 机制支持 Codex CLI，零平行体系，复用已有 initiative 调度链路。

## Golden Path（核心场景）

系统从 [POST /api/brain/tasks executor=codex] → 经过 [Brain tick pick up → 双层守门 → spawn codex 容器 → entrypoint codex 分支执行] → 到达 [PR 产出 + initiative_runs 落行 + harness-report 回写 completed]

具体：
1. 主理人 POST `/api/brain/tasks`（harness_initiative + orchestrator=skill-relay + executor=codex）→ executor 白名单校验通过入队；非法 executor 值 → 400 拒绝；executor=codex 但 orchestrator≠skill-relay → 400
2. Brain tick pick up → spawnSkillRelaySession 读 payload.executor 分支 → 额度软闸（team2 5h 窗口剩余 <30% → defer codex_quota_low，不烧 attempts）→ 双层并发守门 MAX=1（进程内 _activeCodexRelays check-and-set；DB 计数 `orchestrator_host='skill-relay-codex' AND phase NOT IN ('done','failed') AND deadline_at > NOW() AND initiative_id != $1` 跨重启兜底）→ spawnDockerDetached 起 codex 容器（容器名 `cecelia-relay-<short>-cx`；挂载 $CODEX_RELAY_HOME→/home/cecelia/.codex:rw）→ initiative_runs 落行（orchestrator_host='skill-relay-codex' + deadline 8h）
3. entrypoint 按 CECELIA_EXECUTOR=codex 分支跑 `codex exec -c approval_policy="never" -c sandbox_mode="danger-full-access"`；PIPESTATUS[0] 取真退出码；exit 0 但 stdout 含错误关键词（401/unauthorized/usage limit/stream error）→ 改判非零；callback 前 sed 洗 stdout 尾部 token（ghp_/gho_/ghs_/github_pat_）；dispatch 日志打 "goal-hook N/A for codex"；callback 段不动
4. codex session 内 controller 按映射头逐棒 spawn_agent → 出真 PR → harness-report 回写 completed
5. 失败路径：spawn 失败 → `[skill-relay][ALERT]` 日志 + task 回滚 queued + claimed_by/claimed_at 清空；中途死/无 PR → watchdog docker ps 判死 + 重点火（codex attempts 上限 2；守门拒绝/软闸 defer 不烧 attempts）；8h 逾期 → scanStuckHarness 收尸；/tmp/cecelia-prompts 14 天保留期

## 边界情况

- executor 非 claude/codex → tasks POST 400
- executor=codex 但 orchestrator≠skill-relay → 400
- 双层守门同时命中（进程锁 + DB 计数）→ defer，不烧 attempts
- 软闸 defer（quota <30%）→ 不烧 attempts，task 保持 queued
- spawn 失败（容器未起）→ 无 run 行落库 → task 回滚 queued
- watchdog 重点火时 attempts 按 orchestrator_host 分支（codex=2，claude 维持 5）

## 范围限定

**在范围内**：executor=codex 分支逻辑（6 个文件 + tests）、Dockerfile 安装 @openai/codex、entrypoint codex 分支、双层守门、额度软闸、8h deadline、watchdog attempts 上限分支、/tmp/cecelia-prompts 清理 cron 补一行、executor 白名单 + 组合校验

**不在范围内**：修改 claude 分支现有逻辑、review 池 team1 账号、任何 UI 变更、codex login 流程（走 codex-login skill 排班）

## 假设

- [ASSUMPTION: CODEX_RELAY_HOME 默认值 = ~/.codex-team2，可通过环境变量覆盖]
- [ASSUMPTION: @openai/codex npm 包在 Dockerfile 可以 `npm i -g @openai/codex` 安装且 `codex --version` 冒烟通过]
- [ASSUMPTION: team2 quota 5h 窗口检查通过现有 Brain DB 或 codex CLI 可查询]

## 预期受影响文件

- `docker/cecelia-runner/Dockerfile`：新增 `RUN npm i -g @openai/codex` + 冒烟 `codex --version`
- `docker/cecelia-runner/entrypoint.sh`：run_agent 函数按 CECELIA_EXECUTOR 分支 + PIPESTATUS + 错误关键词改判 + token 洗敏
- `packages/brain/src/docker-executor.js`：workflowsDir mount 无条件化 + buildDockerArgs extraMounts 透传
- `packages/brain/src/harness-skill-relay.js`：executor 分支 + 额度软闸 + 双层守门 + deadline 8h + spawn 失败回滚 + codex 映射头拼装
- `packages/brain/src/harness-relay-watchdog.js`：attempts 上限按 orchestrator_host 分支（codex=2，claude=5）
- `packages/brain/src/routes/`（tasks POST）：executor 白名单 + 组合校验
- `packages/brain/scripts/` 或对应 cron：/tmp/cecelia-prompts 14 天清理一行
- vitest 测试文件：覆盖上述各点

## NFR 约束

<!-- 来源: PrepPRD 显式值（优先）+ decisions 表 category=nfr（decisions 无额外 NFR） -->
- 超时/延迟: codex session deadline = 8h
- 频控: team2 5h 窗口剩余 <30% → 软闸 defer（不烧 attempts）；codex 并发 MAX=1
- 版本要求: @openai/codex 最新可用版本（npm i -g）
- 可观测: spawn 失败必须写 [skill-relay][ALERT] 日志；docker logs -f 或 tail stdout 可围观；dispatch 日志显式打 "goal-hook N/A for codex"；callback 前 token 洗敏

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重 -->
- [单slot串行] 同一 slot 同时只允许一个任务在跑；任务内只读子代理可扇出，写代码实现者同一时刻永远只有一个（来源: area）
- [禁写死环境假设] 屏幕外坐标/假设调用方传X/假设.env有Y 等环境假设值禁止写死，要么从环境推导要么真机校准（来源: area）
- [真环境验证才算done] 接缝断言必须在真目标上验证过才算 done；未真验只能标 logic-done-pending（来源: area）
- [测试默认多租户] 单元/E2E 测试默认种 ≥2 个租户并断言互不串（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [日志脱敏] 客户隐私/PII/聊天内容不得明文进日志（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth；无鉴权端点不准 ship（来源: area）
- [租户隔离] 碰租户数据的查询/写入必须 scope 到当前租户；跨租户数据绝不混读/混写（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
（本 line 暂无历史 golden_path 记录）

## E2E 验收

> Planner 初稿此区块留占位。最终可执行 E2E 脚本由 proposer 在 GAN 阶段产出（target_environment=local_api → curl+psql）。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本
# 期望验收点（自然语言）：
# 1. POST /api/brain/tasks executor=codex → 200 入队（非法值 → 400）
# 2. Brain tick pick up → initiative_runs 落行含 orchestrator_host='skill-relay-codex' + deadline 8h
# 3. Docker 容器起动（容器名含 cecelia-relay-...-cx）+ CECELIA_EXECUTOR=codex 分支执行
# 4. 守门：第二个 executor=codex 任务并发 → defer（不烧 attempts）
# 5. 软闸：team2 quota <30% → defer codex_quota_low
# 6. watchdog 判死 + 重点火（codex attempts 上限 2 生效）
# 7. Dockerfile codex --version 冒烟通过
```

## journey_type: autonomous
## journey_type_reason: 纯后端 Brain 改动（packages/brain/src/ + docker/cecelia-runner/），无 UI/前端/agent 协议涉及
## target_environment: local_api
## target_environment_reason: 纯后端 Brain API 验证，curl localhost:5221 + psql + docker ps 本地执行
## journey_id: bb8cc561-b3ee-4fec-b74d-2255694bd963
## step_id: （PrepPRD 未指定 step_id）
