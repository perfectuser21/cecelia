# Sprint PRD — harness relay 收编 grok executor——三厂商走量格局落地

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：codex executor 已在 PR 内实证并合并（isCodex 分支 + CODEX_RELAY_HOME 挂载）；dispatch-worker.mjs:37 grok vendor 已有 buildCommand 实现
- **本次推进预期**：grok 作为第三 executor 进 relay 正式白名单，三厂商（claude/codex/grok）走量格局完整落地

## 背景

Brain task a598772e，title「harness relay 收编 grok executor——三厂商走量格局落地」。
本任务目标：把 grok 收编进 harness skill-relay 当正式 executor，对 codex 先例（isCodex
分支，harness-skill-relay.js:101）1:1 照抄。dispatch-worker.mjs:37 已有经验证的 grok
buildCommand（`~/.grok/bin/grok -p <brief> --cwd <dir> --always-approve`），grok
无用量 API（auth.json 存在即恒可用）的 quota 语义也已在 dispatch-worker.mjs:66-68 处理。

## Golden Path（核心场景）

1. [触发条件] Brain 派发 payload.executor=grok + orchestrator=skill-relay 的
   harness_initiative 任务（headless 或 headed 模式）
2. [系统处理] spawnSkillRelaySession 识别 isGrok=true →
   - 凭据挂载：GROK_RELAY_HOME env → 容器内 `/home/cecelia/.grok`（照 CODEX_RELAY_HOME 先例）
   - 启动命令：`~/.grok/bin/grok -p <prompt> --cwd <dir> --always-approve`
   - initiative_runs 落行：orchestrator_host='skill-relay-grok'，deadline=8h（对齐 codex）
   - headed 分支：HEADED_HOSTS 加 grok 映射，tmux prefix 'grok-relay-'
   - relay.js:471 入口白名单：executor 合法值扩展为 claude/codex/grok
   - 额度撞墙：侦测 QUOTA_WALL_PATTERNS（out of credits/rate limit/429）→ fallback 降级 claude 重试一次
3. [可观测结果] grok 容器日志可见 `~/.grok/bin/grok` 进程运行；
   Final E2E: executor=grok 最小任务走完 relay 全链（planner-GAN-generator-evaluator）出 PR 并 merge

## 边界情况

- GROK_RELAY_HOME 未配置（显式空字符串）→ loud 失败 + task 回滚（照 CODEX_RELAY_HOME 先例）
- GROK_RELAY_HOME 未定义（undefined）→ 允许继续（测试注入 spawnFn 覆盖）
- grok 撞墙（输出含 QUOTA_WALL_PATTERNS）→ 降级到 claude executor 重试一次，不重试 grok
- 不改 claude/codex 的既有行为（isCodex/isClaudeHeaded 逻辑路径不动）

## 范围限定

**在范围内**：
- `packages/brain/src/harness-skill-relay.js`：isGrok 分支 + GROK_RELAY_HOME 门禁 + headed 映射 + executor 入口白名单
- `packages/brain/src/__tests__/harness-skill-relay.test.js`：grok happy path + GROK_RELAY_HOME 门禁 + 撞墙 fallback 单测
- `packages/brain/scripts/smoke/relay-grok-executor-smoke.sh`：参照 relay-codex-executor-smoke.sh
- docker-compose.yml / runner 镜像：GROK_RELAY_HOME env 注入；grok 二进制若需随镜像打包说明 rebuild 步骤

**不在范围内**：不改 dispatch-worker.mjs 已有 grok vendor 实现；不改 claude/codex 路径

## 假设

- [ASSUMPTION: dispatch-worker.mjs:37 grok buildCommand 已验证，容器内 ~/.grok/bin/grok 路径已正确]
- [ASSUMPTION: GROK_RELAY_HOME 由 docker-compose 注入，宿主 ~/.grok 含 auth.json 且权限 600]
- [ASSUMPTION: grok 二进制可在 relay 容器 PATH 下执行或由 GROK_RELAY_HOME 完整挂载]

## 预期受影响文件

- `packages/brain/src/harness-skill-relay.js`：核心改动，isGrok 分支 + GROK_RELAY_HOME + headed 映射 + 白名单
- `packages/brain/src/__tests__/harness-skill-relay.test.js`：新增 grok 相关单测
- `packages/brain/scripts/smoke/relay-grok-executor-smoke.sh`：新增 smoke 脚本
- `docker-compose.yml`：GROK_RELAY_HOME env 注入（照 CODEX_RELAY_HOME 先例）

## E2E 验收

```bash
# Final E2E 验收点（精确断言）：
# 1. 注册 executor=grok 最小 harness 任务后，initiative_runs 落行：
#    orchestrator_host='skill-relay-grok'，phase 非 failed，deadline 约 8h 后
# 2. grok 容器日志（docker logs cecelia-relay-<short>-gk）含 ~/.grok/bin/grok 启动行
# 3. 任务走完 relay 全链（planner → GAN → generator → evaluator），最终出 PR URL 并 merge
# 4. 撞墙 fallback 单测：detectQuotaWall 输出命中 QUOTA_WALL_PATTERNS → ok=false + 降级 claude 重试一次
# 5. bash packages/brain/scripts/smoke/relay-grok-executor-smoke.sh 全部 PASS
# 6. 既有 claude/codex 单测全部仍 PASS（不回归）
```

## NFR 约束

- 超时/延迟：grok executor deadline 与 codex 对齐（8h），watchdog 覆盖
- 频控：无（grok 无额度 API，auth.json 存在即可用，无需软闸）
- 回归保护：改动后 `packages/brain/src/__tests__/harness-skill-relay.test.js` 全量通过，CI 不降绿
- 可观测：initiative_runs.orchestrator_host='skill-relay-grok' 可在 /api/brain/harness/runs 查到
- 凭据安全：GROK_RELAY_HOME 只挂 auth.json 所在目录，不进 git/日志

## Invariant 约束（铁律，proposer/evaluator 不得违反）

- [smoke 登记纪律] feat+brain/src PR 开 PR 前直接一次带齐 smoke.sh + smoke-allowlist 登记，别等 CI 两连红（来源：area learning）
- [真环境验证才算 done] 依赖真机/生产 env/真实调用方的接缝断言必须在真目标上验证过才算 done，未真验只能标 logic-done-pending（来源：area）
- [禁止写死环境假设值] 路径/阈值等环境假设禁止写死，要么从 env 推导要么真机校准（来源：area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源：area）
- [日志脱敏] 客户隐私/PII/聊天内容不得明文进日志（来源：area）
- [单 slot 串行] 一个 slot/会话内严格串行执行任务，跨 slot 才允许并行（来源：area）
- [headed relay 点火必须写 base_repo/pr_url] headed relay 点火时必须把 base_repo 或 pr_url 写入 task payload，且分支名带 task short id，否则 finalizeHarnessTask 收账守卫与 watchdog GitHub 反查双双失明（来源：area invariant 37e0d7c9）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

- codex executor relay（isCodex 分支，harness-skill-relay.js:101）：CODEX_RELAY_HOME 挂载 + 进程内/DB 并发守门 + 8h deadline + orchestrator_host='skill-relay-codex' → 已在 main，不得改动
- claude executor relay（default 路径）：无额外守门，6h deadline，orchestrator_host='skill-relay-session' → 已在 main，不得改动
- headed 模式（codex/claude）：HEADED_HOSTS 映射 + tmux 前缀 + ssh 逃逸路径 → 已在 main，grok 需新增映射但不动现有两项
- dispatch-worker.mjs grok buildCommand（:37）：`~/.grok/bin/grok -p <brief> --cwd <dir> --always-approve` + QUOTA_WALL_PATTERNS 撞墙识别 → 已在 main，relay 侧直接沿用逻辑，不重复实现

## journey_type: dev_pipeline
## journey_type_reason: 本 sprint 改动 packages/brain/src/ 核心 relay 路径（代码变更 + 测试 + smoke），journey_id=bb8cc561 定义即 dev_pipeline，沿用
## target_environment: local_api
## target_environment_reason: 验收对象是 Brain API（localhost:5221）+ 本地 Docker relay 容器，无 UI 交互，curl+docker logs 验证方式
## journey_id: bb8cc561-b3ee-4fec-b74d-2255694bd963
## task_id: a598772e-7f74-40f0-a022-d0e8d2b35dc0
