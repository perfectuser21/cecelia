# Sprint PRD — attempt-run 桥接使用说明

task_request_hash: 9500b3718c9bd4a410e94d9b3747988db025f8d377b3f17d0d9755b15666cf17

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：补齐 attempt-run 桥接的可操作文档，降低错误调用与回滚状态误判风险

## 背景

为宿主机与远端调用方提供一页中文《attempt-run 桥接使用说明》，使调用方能正确发起 attempt、查询状态，并理解鉴权、角色、payload 与派发失败回滚合同。

## Golden Path（核心场景）

调用方从阅读 `docs/current/` 下《attempt-run 桥接使用说明》进入 → 按鉴权与 payload 合同调用 `POST /api/brain/harness/attempt-run` → 使用返回的标识调用 `GET /api/brain/harness/attempt-run/:id` 查询 → 能判断已派发状态或派发失败后的完整回滚状态。

具体：
1. 文档分别说明 `POST /api/brain/harness/attempt-run` 用于创建并派发 attempt，`GET /api/brain/harness/attempt-run/:id` 用于按 id 查询 attempt-run 状态。
2. 文档说明两端点采用 `internalAuthOrLoopback`；宿主机或远端请求必须携带 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN`，且不得展示真实 token。
3. 文档明确九项角色白名单：`planner`、`proposer`、`critic`、`generator`、`generator-fix`、`evaluator`、`evaluator-fix`、`judge`、`reporter`。
4. 文档明确 payload 必填 `sprint_dir`、`base_repo`、`branch`；`base_sha` 可省略，并由生产 Brain 自解析。
5. 文档明确派发失败时自动回滚的最终状态链：`run → failed`、`session → closed`、`task → cancelled`。
6. 读者据此可构造请求、查询对应 run，并从结果辨别成功派发或失败回滚。

## 边界情况

- 非 loopback 且缺少或携带无效 Bearer token 的请求不得被描述为可访问。
- 白名单外角色不得被描述为可派发。
- 缺少任一必填 payload 字段的示例不得被描述为有效请求；`base_sha` 不得误写为必填。
- 派发失败说明必须同时覆盖 run、session、task 三类对象的最终状态，不能只描述部分回滚。

## 范围限定

**在范围内**：仅在 `docs/current/` 新增一页中文《attempt-run 桥接使用说明》，覆盖两个端点、鉴权、九项角色白名单、payload 字段合同及失败回滚行为。

**不在范围内**：不修改端点、鉴权、派发、回滚逻辑，不修改任何代码、配置或既有文档，不新增 API 行为。

## 假设

- [ASSUMPTION: 文档文件名采用能直观表达主题的英文 kebab-case；最终文件必须位于 `docs/current/`。]
- [ASSUMPTION: Unified Map 未配置（task.payload.map_scope/map_repo 缺失），本次 scope 仅以冻结 thin_prd 的 `docs/current/` 位置词锚定。]

## 预期受影响文件

- `docs/current/attempt-run-bridge-guide.md`：新增中文《attempt-run 桥接使用说明》；这是唯一允许变更的交付文件。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 待定（PrepPRD 未指定）
- 可观测: 文档必须使读者可辨认成功派发与三对象失败回滚结果

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；以下为与本纯文档 scope 有直接约束关系的有效项 -->
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth；无鉴权端点不准 ship（来源: area）
- [禁止写死环境] 环境假设值不得写死，须由环境推导（来源: area）
- [Planner 分支] Planner 必须留在服务端签发的 planner_branch，Provider 不得切换分支（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

- （本 line 暂无历史）

## E2E 验收

```bash
# 占位：proposer 将按 target_environment 填入真实脚本。
# 期望验收点：断言 docs/current/ 下新增且仅新增一页中文文档；文档包含两个端点字面、internalAuthOrLoopback、Bearer CECELIA_INTERNAL_TOKEN、九项角色、三个必填字段、base_sha 省略语义、三对象失败回滚状态；并断言未改任何代码。
```

## 可执行验收断言

1. `[ARTIFACT]` Git diff 中唯一交付变更是 `docs/current/attempt-run-bridge-guide.md`，不存在代码文件变更。
2. `[BEHAVIOR]` 文档为中文，并同时包含 `POST /api/brain/harness/attempt-run` 与 `GET /api/brain/harness/attempt-run/:id` 及各自用途。
3. `[BEHAVIOR]` 文档包含 `internalAuthOrLoopback`、`Bearer`、`CECELIA_INTERNAL_TOKEN`，并说明宿主/远端调用必须带该 token。
4. `[BEHAVIOR]` 文档逐项包含九个角色且明确其为白名单。
5. `[BEHAVIOR]` 文档将 `sprint_dir`、`base_repo`、`branch` 标为 payload 必填，并说明 `base_sha` 可省略且由生产 Brain 自解析。
6. `[BEHAVIOR]` 文档包含 `run`→`failed`、`session`→`closed`、`task`→`cancelled` 的派发失败自动回滚合同。

## journey_type: autonomous
## journey_type_reason: 交付物是 Cecelia 后端 Harness API 的纯文档说明，无 UI 或远端 agent 协议行为变更
## target_environment: mac_web
## target_environment_reason: task payload 显式指定 mac_web；验收在仓库工作区执行文档与 diff 检查
## journey_id: none
## step_id: none（PrepPRD 未锚定）
