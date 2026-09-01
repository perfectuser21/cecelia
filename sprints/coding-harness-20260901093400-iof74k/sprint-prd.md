# Sprint PRD — attempt-run 桥接使用说明

task_request_hash: 27bfc41a014fd93b321093b1ae1153e5bf63e83fb25bedc381832a67b75c92a5

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：补齐 attempt-run 桥接的中文操作契约，降低接入与故障判断歧义

## 背景

为宿主及远端调用方提供一页可直接核对的 attempt-run 桥接说明，使调用入口、查询入口、鉴权、角色、请求字段及派发失败后的状态收口都有统一依据。

## Golden Path（核心场景）

调用方从阅读 `docs/current/` 下《attempt-run 桥接使用说明》开始 → 按鉴权与 payload 约束发起 `POST /api/brain/harness/attempt-run` → 使用返回的 attempt 标识调用 `GET /api/brain/harness/attempt-run/:id` 查询 → 能判断正常派发或失败回滚后的最终状态。

具体：
1. 文档分别说明 `POST /api/brain/harness/attempt-run` 用于创建并派发 attempt，`GET /api/brain/harness/attempt-run/:id` 用于按 id 查询 attempt 状态。
2. 文档说明两端点使用 `internalAuthOrLoopback`；宿主或远端请求必须携带 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN`，且不得展示真实 token。
3. 文档明确列出九项角色白名单：`planner`、`proposer`、`critic`、`generator`、`generator-fix`、`evaluator`、`evaluator-fix`、`judge`、`reporter`。
4. 文档说明 POST payload 必填 `sprint_dir`、`base_repo`、`branch`；`base_sha` 可省略，由生产 Brain 自解析。
5. 文档说明派发失败会自动回滚为 `run→failed`、`session→closed`、`task→cancelled`，调用方可据此确认失败已收口。

## 边界情况

- 非 loopback 且无有效 Bearer token 的请求不得被描述为可用调用方式。
- `base_sha` 缺省不应被误写为请求非法；其解析责任属于生产 Brain。
- 派发失败不得被描述为保留运行中状态，三类对象的终态必须完整列出。
- 九项角色必须恰好列全，不使用“等”省略，也不引入白名单外角色。

## 范围限定

**在范围内**：仅新增 `docs/current/attempt-run-bridge-guide.md` 中文文档，包含端点用途与鉴权、九项角色白名单、payload 字段、失败自动回滚四节。

**不在范围内**：不修改产品代码、路由、鉴权实现、角色白名单、数据库状态机、测试或其他文档。

## 假设

- [ASSUMPTION: 文档文件名采用 `attempt-run-bridge-guide.md`；标题固定为《attempt-run 桥接使用说明》。]
- [ASSUMPTION: 九项角色名称按当前 Harness 角色命名书写，文档只陈述现有契约，不扩展白名单。]
- [ASSUMPTION: 本任务未配置 `map_scope/map_repo`，因此 Unified Map 状态记为未配置，不据目录推断额外范围。]

## 预期受影响文件

- `docs/current/attempt-run-bridge-guide.md`：新增中文《attempt-run 桥接使用说明》。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 待定（PrepPRD 未指定）
- 可观测: 文档必须明确派发失败后的 run、session、task 三类状态

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；以下为与本次文档合同直接相关的活跃 area 铁律 -->
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth，无鉴权端点不准 ship（来源: area）
- [环境假设] 环境假设值不得写死，必须从环境推导或真实校准（来源: area）
- [真环境验证] 依赖真实调用方的接缝断言必须在目标环境验证后才算完成（来源: area）
- [Planner 分支] Planner 必须停留在服务端签发分支，不得自行切换（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

- （本 line 暂无历史）

## E2E 验收

```bash
set -euo pipefail
DOC=docs/current/attempt-run-bridge-guide.md
test -f "$DOC"
grep -q 'attempt-run 桥接使用说明' "$DOC"
grep -q 'POST /api/brain/harness/attempt-run' "$DOC"
grep -q 'GET /api/brain/harness/attempt-run/:id' "$DOC"
grep -q 'internalAuthOrLoopback' "$DOC"
grep -q 'Bearer.*CECELIA_INTERNAL_TOKEN' "$DOC"
for role in planner proposer critic generator generator-fix evaluator evaluator-fix judge reporter; do grep -q "$role" "$DOC"; done
for field in sprint_dir base_repo branch; do grep -q "$field" "$DOC"; done
grep -q 'base_sha.*可省略\|base_sha.*省略' "$DOC"
grep -q 'run.*failed' "$DOC"
grep -q 'session.*closed' "$DOC"
grep -q 'task.*cancelled' "$DOC"
test "$(git diff --name-only 5599211397c88c3827d5ce4e9c6061b3802b4fc5...HEAD | grep -v '^docs/current/attempt-run-bridge-guide\.md$' | wc -l | tr -d ' ')" = 0
```

## journey_type: dev_pipeline
## journey_type_reason: 文档面向 Harness attempt-run 开发派发流程，属于 Engine/Harness 开发管线使用契约。
## target_environment: mac_web
## target_environment_reason: task payload 显式指定 mac_web；验收在 macOS 工作区以文件与 git 差异检查完成。
## journey_id: none
## step_id: none（PrepPRD 未锚定）
