# Sprint PRD — attempt-run 桥接使用说明

task_request_hash: 377fbc81f745c24bce3c1b70e9bd7134f75a9b009c6ab333c3783863418ffc26

## OKR 对齐

- **对应 KR**：未配置（任务 payload 未提供 KR 锚点）
- **当前进度**：未配置
- **本次推进预期**：新增一页可检索、可按测试机械验收的桥接使用说明

## 背景

attempt-run 桥接已有生产 Brain 端点，需要在 `docs/current/` 提供中文使用说明，使宿主和远端调用方能正确发起运行、查询状态，并理解派发失败后的自动回滚结果。

## Golden Path（核心场景）

调用方从阅读 `docs/current/` 下《attempt-run 桥接使用说明》进入 → 按文档选择创建或查询端点并携带正确鉴权 → 使用完整 payload 发起派发 → 在失败时依据文档确认 run、session、task 均已回滚到终态。

具体：
1. 调用方看到 `POST /api/brain/harness/attempt-run` 用于创建 attempt-run，`GET /api/brain/harness/attempt-run/:id` 用于按 id 查询运行状态。
2. 调用方看到两端点均使用 `internalAuthOrLoopback`；宿主或远端请求必须携带 `Authorization: Bearer <CECELIA_INTERNAL_TOKEN>`，文档不得暴露真实凭据。
3. 调用方看到角色白名单的九个规范角色值，且列表恰好九项，不使用未登记别名。
4. 调用方看到创建 payload 必填 `sprint_dir`、`base_repo`、`branch`；`base_sha` 可省略，并由生产 Brain 自行解析。
5. 调用方看到派发失败会自动回滚为 `run → failed`、`session → closed`、`task → cancelled`，不会留下仍运行的孤儿状态。

## 边界情况

- 区分 loopback 与宿主/远端调用，不能把 loopback 可访问误写成宿主/远端免鉴权。
- `base_sha` 是可选字段，不能与三个必填字段混列。
- 查询端点中的 `:id` 表示目标 attempt-run id，不能写成创建端点参数。
- 九项角色白名单必须使用生产合同中的规范值，不能增删或改写。
- 回滚描述必须同时覆盖 run、session、task 三类状态及其最终值。

## 范围限定

**在范围内**：仅在 `docs/current/` 新增一页中文文档；覆盖两个 attempt-run 端点用途、鉴权、九项角色白名单、payload 字段和派发失败自动回滚；提供可由测试文件覆盖的机械验收断言。

**不在范围内**：修改任何代码、路由、鉴权逻辑、角色白名单、数据库状态机、既有测试行为或其他文档；新增 API 行为；改变生产 Brain 的 `base_sha` 解析规则。

## 假设

- [ASSUMPTION: 文档文件名可由实现者按 `docs/current/` 现有命名规范确定，但只能新增一页。]
- [ASSUMPTION: 九项角色的具体规范值以实现基线 `5599211397c88c3827d5ce4e9c6061b3802b4fc5` 中生产白名单为准；本 PRD 不凭空定义或更改白名单。]
- [ASSUMPTION: Unified Map 未配置，因为 task payload 未同时提供有效的 map_scope 与 map_repo。]

## 预期受影响文件

- `docs/current/<attempt-run-bridge-guide>.md`：新增《attempt-run 桥接使用说明》中文文档；实际文件名遵循目录既有命名规范。

## 可执行验收计划

1. 测试断言 `docs/current/` 相对实现基线只新增一份 Markdown 文档，且仓库代码文件无变化。
2. 测试读取新增文档，断言同时包含 `POST /api/brain/harness/attempt-run` 与 `GET /api/brain/harness/attempt-run/:id`，并分别说明创建与查询用途。
3. 测试断言文档包含 `internalAuthOrLoopback`、`Bearer`、`CECELIA_INTERNAL_TOKEN`，并明确宿主/远端必须携带该 Bearer token；同时扫描无真实 token 值。
4. 测试从“角色白名单”章节提取列表，断言恰好九项，并逐项等于实现基线生产白名单中的规范角色值。
5. 测试从 payload 章节断言 `sprint_dir`、`base_repo`、`branch` 标为必填，`base_sha` 标为可省略且由生产 Brain 自解析。
6. 测试从回滚章节断言同一段完整出现 `run`/`failed`、`session`/`closed`、`task`/`cancelled` 三组状态映射。
7. 测试断言文档包含中文字符，且不存在将本 sprint 扩展为代码改动的内容。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 实现基线 `5599211397c88c3827d5ce4e9c6061b3802b4fc5`
- 可观测: 文档内容须能由测试文件逐节机械断言

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；列出与本只读文档 sprint 直接相关的有效铁律 -->
- [分支签发] Planner workspace 必须保持服务端签发的 planner_branch，Provider 不得切换分支（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth；无鉴权端点不准 ship（来源: area）
- [禁止写死] 环境假设值不得写死，必须由环境推导或真实校准（来源: area）
- [真环境验证] 依赖生产环境的接缝断言须在真实目标验证后才可标 done（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

（本 line 暂无历史）

## E2E 验收

```bash
# 占位：proposer 将按 target_environment 填入真实脚本。
# 期望验收点：在实现基线上执行文档合同测试，确认 docs/current/ 新增中文说明完整覆盖四节要求、九项角色与失败回滚三状态，且没有代码改动。
```

## journey_type: dev_pipeline
## journey_type_reason: 该文档说明 Harness attempt-run 桥接的开发与派发使用合同。
## target_environment: local_api
## target_environment_reason: 文档合同测试与生产 Brain 自解析语义在本地 evaluator/localhost:5221 验证。
## journey_id: none
## step_id: none（PrepPRD 未锚定）
