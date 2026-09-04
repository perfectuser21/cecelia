# Sprint PRD — attempt-run 桥接使用说明

task_request_hash: 66898aa10166d40ce1ebe3eab448721fe57997741117bb89e8f6c5506d3b43c1

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：补齐 attempt-run 桥接的可执行使用说明

## 背景

为宿主与远端调用方提供一页中文的 attempt-run 桥接说明，明确端点、鉴权、角色、请求载荷和失败回滚契约，减少错误派发与误判成功。

## Golden Path（核心场景）

调用方从阅读 `docs/current/` 下《attempt-run 桥接使用说明》进入 → 按说明发起 attempt-run 并查询状态 → 能理解派发结果或失败后的完整回滚状态。

具体：
1. 文档分别说明 `POST /api/brain/harness/attempt-run` 用于创建并派发一次角色运行，`GET /api/brain/harness/attempt-run/:id` 用于按 id 查询运行状态。
2. 文档说明两端点使用 `internalAuthOrLoopback`；宿主或远端请求必须携带 `Authorization: Bearer <CECELIA_INTERNAL_TOKEN>`，不得展示真实令牌。
3. 文档逐项列出生产契约允许的九个角色，并明确角色值不在白名单时不能派发。
4. 文档说明 payload 必填 `sprint_dir`、`base_repo`、`branch`；`base_sha` 可省略，省略时由生产 Brain 自解析。
5. 文档说明派发失败后的自动回滚终态：`run → failed`、`session → closed`、`task → cancelled`。

## 边界情况

- 非 loopback 的宿主或远端请求缺少或使用错误 Bearer 凭据时，不应被描述为可成功调用。
- 缺少任一必填 payload 字段或角色不在九项白名单时，不应被描述为可派发。
- 派发失败不得留下仍运行的 run、未关闭的 session 或未取消的 task。

## 范围限定

**在范围内**：仅在 `docs/current/` 新增一页中文《attempt-run 桥接使用说明》，覆盖两个端点、鉴权、九项角色白名单、payload 字段和失败自动回滚四节。

**不在范围内**：不修改端点行为、鉴权逻辑、角色白名单、数据模型、生产配置、测试或任何产品代码。

## 假设

- [ASSUMPTION: 九项角色的名称以生产 Brain 当前白名单为准，文档必须逐项照录且恰好九项，不能推测或另造别名。]
- [ASSUMPTION: Unified Map 未配置，因为 task.payload.map_scope/map_repo 未提供有效映射。]

## 预期受影响文件

- `docs/current/attempt-run-bridge.md`: 新增《attempt-run 桥接使用说明》；文件名可由 proposer 在保持目录与标题不变的前提下确定。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 待定（PrepPRD 未指定）
- 可观测: 派发失败的 run、session、task 三类终态必须可由说明中的查询路径理解。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源按 id 去重；以下为与本纯文档范围直接相关的有效铁律 -->
- [端点鉴权] 每个 API 端点必须有 auth；无鉴权端点不准 ship（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [规划分支] Planner 必须保持服务端签发的 planner_branch，不得 checkout 或切换分支（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

- （本 line 暂无历史）

## E2E 验收

```bash
# 占位：proposer 将按 target_environment 填入真实脚本。
# 期望验收点：docs/current/ 存在一页中文说明；正文分节覆盖两个端点及用途、internalAuthOrLoopback 与远端 Bearer 要求、恰好九项角色白名单、payload 三项必填与 base_sha 省略规则、三段失败回滚终态；git diff 不含产品代码。
```

## journey_type: autonomous
## journey_type_reason: 交付物是 Cecelia 仓库内部 Harness API 的使用说明，不含用户界面或远端 agent 协议变更。
## target_environment: mac_web
## target_environment_reason: task payload 显式指定 mac_web；验收在对应 Cecelia 工作区检查中文文档及变更范围。
## journey_id: none
## step_id: none（PrepPRD 未锚定）
