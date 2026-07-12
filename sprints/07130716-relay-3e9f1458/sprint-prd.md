# Sprint PRD — headless-smoke

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：验证 headed 改动后，headless codex relay 仍可被 Brain API 接受且不误入 headed 分支

## 背景

本 sprint 使用 Research 补料作为 PrepPRD 代料。来源锚定为 `packages/brain/scripts/smoke/codex-headed-dispatch-smoke.sh` 第 3 个 smoke case：创建 `title=headless-smoke`，payload 仅包含 `orchestrator=skill-relay`、`executor=codex`、`mode=headless`，验收 `POST /api/brain/tasks` 返回 200/201。历史上下文只用于防回归，不扩大本 sprint 范围。

## Golden Path（核心场景）

用户/系统从本地 Brain API 创建 `headless-smoke` harness initiative → 经过任务 payload 校验 → 到达可观测的 task id 返回，且 headless 不进入 headed/tmux host。

具体：
1. 调用方 POST `/api/brain/tasks`，创建 `harness_initiative`，payload 为 `executor=codex`、`orchestrator=skill-relay`、`mode=headless`。
2. Brain 接受合法 headless codex relay payload，返回 200/201 与新 task `id`。
3. 调用方提交非法 `mode` 时，Brain 返回 400；如触发 tick 处理，headless 任务不得落到 `orchestrator_host=skill-relay-codex-headed`。

## 边界情况

- `executor=codex` 缺少 `orchestrator=skill-relay` 时，不应被当作本合法路径。
- `mode` 只能接受 `headless|headed`，其他值返回 400。
- headless smoke 不要求真实 codex 完成 PR，也不要求 headed/tmux/tui.log 或人工 review 闭环。

## 范围限定

**在范围内**：本地 API 创建 harness initiative；合法 headless codex relay payload 返回 200/201 + id；非法 mode 返回 400；可选 tick 处理时确认未落到 headed host。  
**不在范围内**：headed 模式扩展；tmux/tui.log 验证；真实 codex 产出 PR；合同、测试或实现代码编写；人审闭环。

## 假设

- [ASSUMPTION: base_repo 使用 `https://github.com/perfectuser21/cecelia.git`。]
- [ASSUMPTION: Brain 本地服务可通过 `http://host.docker.internal:5221` 或 evaluator 本地等价地址访问。]
- [ASSUMPTION: 本 sprint 的 `journey_id` 与 `step_id` 未由 payload 提供，按 smoke 回归任务处理。]

## 预期受影响文件

- `packages/brain/src/routes/task-tasks.js`: 本地 API payload 校验的行为锚点。
- `packages/brain/scripts/smoke/codex-headed-dispatch-smoke.sh`: headless smoke case 的来源与回归锚点。

## NFR

- 零回归优先：headless 仍是合法模式，且不得因 headed 改动被拒绝。
- 分支隔离：headless 不得触发 headed host、tmux 或 headed 专用日志路径。
- 安全与日志：不得把凭据、PII 或敏感 payload 明文写入日志。
- 资源纪律：尊重 codex relay quota 与并发守门，不为 smoke 扩大执行面。
- 验收环境：API 本地验收，避免依赖外部 runner 或真实 PR 完成。

## Invariant 约束

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重 -->
- [smoke] smoke 铁律（来源: area）
- [feat+brain] feat+brain/src PR 开 PR 前直接一次带齐 smoke.sh + smoke-allowlist 登记，别等 CI 两连红（来源: area）
- [task_type接线] 新 task_type 接线用七点清单：CHECK 约束 / task-router 四表 / EXECUTOR_KIND_FOR / executor dispatch 分支 / executor override 排除 / relay loadSkill 映射 / dispatcher cap+lock+bridge 三防线（来源: area）
- [服务存活] 服务“该活着”的判定用双信号：launchctl 状态 + 端口监听（来源: area）
- [LaunchDaemon] 本机禁止再往 `~/Library/LaunchAgents` 放需要常驻的服务；用系统域 LaunchDaemon + `UserName=administrator`（来源: area）
- [常驻宿主] 新增常驻宿主服务时，必须同步加进 `packages/brain/src/launchd-patrol.js` 的 manifest（来源: area）
- [smoke] smoke 铁律（来源: area）
- [单slot] 一个 slot/会话内严格串行执行任务；并行只许跨 slot，单任务内部只读子代理可扇出，写代码实现者同一时刻只有一个（来源: area）
- [环境假设] 屏幕外坐标/UIA气泡阈值/假设调用方传X/假设.env有Y 等环境假设值禁止写死，要么从环境推导要么真机校准（来源: area）
- [真环境] 依赖真机/生产env/真实调用方的接缝断言必须在真目标上验证过才算 done（来源: area）
- [多租户] 单元/E2E 测试默认种≥2个租户并断言互不串（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [日志脱敏] 客户隐私/PII/聊天内容不得明文进日志（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth；无鉴权端点不准 ship（来源: area）
- [租户隔离] 碰租户数据的查询/写入必须 scope 到当前租户；跨租户数据绝不混读/混写（来源: area）

## 累积 FR

<!-- 来源: 本 line 已完成 ability 的 golden_path；本任务无 journey_id，优雅降级 -->
（本 line 暂无历史）

## E2E 验收

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本。
# 期望验收点：POST /api/brain/tasks 对合法 headless codex relay payload 返回 200/201 + id；非法 mode 返回 400；可选 tick 后不进入 skill-relay-codex-headed。
```

## 元数据

- journey_type_reason: 纯 Brain API / 后台任务 smoke，按 autonomous 处理。
- target_environment_reason: 本地 Brain API curl 验收，目标环境为 local_api。
- journey_id: 未提供
- step_id: codex-headed-dispatch-smoke case 3 / headless-smoke

journey_type: autonomous
target_environment: local_api
