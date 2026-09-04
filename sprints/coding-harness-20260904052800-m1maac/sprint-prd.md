# Sprint PRD — attempt-run 桥接使用说明

task_request_hash: 4a75d011615637791deda3b3f64d30a57539af27e98d53aa5aff7bad47781dbd

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：补齐 attempt-run 桥接的可操作中文说明，不承诺改动 KR 百分比

## 背景

为宿主与远端调用方提供一页可核对的 attempt-run 桥接说明，降低端点、鉴权、角色、payload 与失败回滚语义的误用风险。

## Golden Path（核心场景）

调用方从阅读 `docs/current/` 下《attempt-run 桥接使用说明》进入 → 按说明鉴权并创建、查询 attempt-run → 能据返回状态判断派发成功或失败回滚结果。

具体：
1. 文档分别说明 `POST /api/brain/harness/attempt-run` 用于创建并派发运行，`GET /api/brain/harness/attempt-run/:id` 用于按 id 查询运行状态。
2. 文档说明两端点采用 `internalAuthOrLoopback`；宿主或远端请求必须携带 `Bearer CECELIA_INTERNAL_TOKEN`。
3. 文档完整列出生产端定义的九项角色白名单，并明确白名单外角色不可派发。
4. 文档说明 payload 必填 `sprint_dir`、`base_repo`、`branch`；`base_sha` 可省略并由生产 Brain 自解析。
5. 文档说明派发失败时自动回滚为 `run→failed`、`session→closed`、`task→cancelled`，调用方可通过查询端点观察该结果。

## 边界情况

- loopback 与宿主/远端的鉴权要求必须区分，不能把 loopback 行为描述成远端免鉴权。
- `base_sha` 只能描述为可省略，不能列入必填字段。
- 派发失败的三个回滚对象及其终态必须全部出现，不能只描述其中一部分。

## 范围限定

**在范围内**：仅新增 `docs/current/` 下的一页中文说明；覆盖两个端点、鉴权、九项角色白名单、payload 字段与失败自动回滚四节。

**不在范围内**：不修改代码、测试、接口行为、鉴权策略、角色白名单、数据结构或部署配置。

## 假设

- [ASSUMPTION: 九项角色名称以生产 Brain 的权威白名单为准，文档必须逐项一致且数量恰为九，不在 Planner 阶段凭空定义。]
- [ASSUMPTION: 文档文件名可由实现者选择清晰的英文短横线命名，但必须直接位于 `docs/current/`。]

## 预期受影响文件

- `docs/current/attempt-run-bridge-guide.md`: 新增《attempt-run 桥接使用说明》中文文档。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 待定（PrepPRD 未指定）
- 可观测: 派发失败后的 run、session、task 终态须可由查询结果核对

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；下列为与本薄片直接适用的 area 铁律 -->
- [端点鉴权] 每个 API 端点必须有 auth；无鉴权端点不准 ship（来源: area）
- [Brain URL 权威] 本地 Dispatcher 与 Fleet Worker 必须使用服务端权威 HARNESS_BRAIN_URL，预检保持 fail-closed，禁止为单个 Attempt 绕过（来源: area）
- [环境路由] target_environment 必须来自任务 payload，禁止从本地文件推断（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

- （本 line 暂无历史）

## E2E 验收

```bash
# 占位：proposer 将按 target_environment 填入真实脚本。
# 期望验收点：机械验证 docs/current/ 新增中文文档，存在四个主题分节；同时包含两个端点、internalAuthOrLoopback、Bearer CECELIA_INTERNAL_TOKEN、九项权威角色、三个必填字段、base_sha 可省略，以及三个失败回滚终态；变更清单中不得出现代码文件。
```

## journey_type: autonomous
## journey_type_reason: 仅新增 Cecelia 后端 Harness API 的使用说明，无用户界面或远端代理协议行为变更
## target_environment: mac_web
## target_environment_reason: task payload 显式指定 mac_web；验收在 Cecelia 仓库工作区执行文档与变更清单检查
## journey_id: none
## step_id: none（PrepPRD 未锚定）
