# Sprint PRD — attempt-run 桥接使用说明

task_request_hash: 7753767def1026ab9d1a60dc3696e49e263c130dfde4409e9b55cb92cf351de2

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：补齐 attempt-run 桥接的可查阅使用合同

## 背景

调用方需要一页中文说明，准确描述 attempt-run 桥接的入口、访问约束、请求合同与失败收口行为，降低宿主和远端接入歧义。

## Golden Path（核心场景）

宿主或远端调用方从 `docs/current/` 的《attempt-run 桥接使用说明》进入 → 按说明鉴权并创建 attempt-run → 使用返回的 id 查询状态 → 能识别派发失败后的完整回滚结果。

具体：
1. 文档分别说明 `POST /api/brain/harness/attempt-run` 用于创建并派发一次运行，`GET /api/brain/harness/attempt-run/:id` 用于按 id 查询运行状态。
2. 文档说明两端点均采用 `internalAuthOrLoopback`；宿主或远端请求必须携带 `Authorization: Bearer <CECELIA_INTERNAL_TOKEN>`，且不得展示真实 token。
3. 文档完整列出角色白名单九项：`planner`、`proposer`、`critic`、`generator`、`generator-fix`、`evaluator`、`evaluator-fix`、`judge`、`reporter`。
4. 文档说明 payload 必填 `sprint_dir`、`base_repo`、`branch`；`base_sha` 可省略，由生产 Brain 自解析。
5. 文档说明派发失败时自动回滚为 `run → failed`、`session → closed`、`task → cancelled`。

## 边界情况

- 明确区分 loopback 与宿主/远端调用，不能暗示远端可免鉴权。
- `base_sha` 只能表述为可省略，不能误写为必填或由调用方任意替代权威基线。
- 失败回滚的三个对象、三个终态及先后关系必须完整，不得只写“请求失败”。

## 范围限定

**在范围内**：在 `docs/current/` 新增一页中文《attempt-run 桥接使用说明》，包含端点与鉴权、九项角色白名单、payload 字段、派发失败回滚四节。

**不在范围内**：修改应用代码、端点行为、鉴权实现、数据库结构、现有文档代码或其他文档页面。

## 假设

- [ASSUMPTION: 文档文件名采用可读且稳定的 `docs/current/ATTEMPT_RUN_BRIDGE_GUIDE.md`。]
- [ASSUMPTION: 九项角色名称以当前生产白名单的连字符形式呈现，并由既有测试断言逐项校验。]
- [ASSUMPTION: task.payload.map_scope/map_repo 未提供有效显式映射，因此 Unified Map 状态记为未配置，不做领域猜测。]

## 预期受影响文件

- `docs/current/ATTEMPT_RUN_BRIDGE_GUIDE.md`：新增中文 attempt-run 桥接使用说明；唯一产品产物。

## DoD（可执行验收断言）

1. `docs/current/ATTEMPT_RUN_BRIDGE_GUIDE.md` 存在且含中文正文。
2. 文档含 POST 与 GET 两个端点原文，并分别说明创建/派发与按 id 查询用途。
3. 文档含 `internalAuthOrLoopback`、`Bearer`、`CECELIA_INTERNAL_TOKEN`，并明确宿主/远端必须携带鉴权头。
4. 文档逐项包含九个白名单角色，且白名单计数为九。
5. 文档明确 `sprint_dir`、`base_repo`、`branch` 必填，`base_sha` 可省略且由生产 Brain 自解析。
6. 文档完整包含 `run → failed`、`session → closed`、`task → cancelled` 三条回滚状态。
7. `git diff --name-only 88929fa377f5bed3cd1876a575c366ff1b93c0d5` 的实现产物仅包含目标文档及合同允许的验收测试文件，不含应用代码。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 语言：简体中文。
- 安全：不得写入真实 `CECELIA_INTERNAL_TOKEN`，仅展示占位符。
- 可维护性：端点、字段、角色与状态均使用可由测试文件逐项匹配的字面值。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；以下为与本 sprint 接缝直接相关的活跃铁律 -->
- [端点鉴权] 每个 API 端点必须有 auth；无鉴权端点不准 ship（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [禁止写死环境] 环境假设值禁止写死，应由环境推导或真实校准（来源: area）
- [真环境验证] 依赖生产环境或真实调用方的接缝断言须在目标环境验证后才算 done（来源: area）
- [Planner 分支] Planner 必须停留在服务端签发的 planner_branch，不得自行切换分支（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

（本 line 暂无历史）

## E2E 验收

```bash
DOC=docs/current/ATTEMPT_RUN_BRIDGE_GUIDE.md
test -f "$DOC"
grep -q 'POST /api/brain/harness/attempt-run' "$DOC"
grep -q 'GET /api/brain/harness/attempt-run/:id' "$DOC"
grep -q 'internalAuthOrLoopback' "$DOC"
grep -q 'Bearer.*CECELIA_INTERNAL_TOKEN' "$DOC"
for role in planner proposer critic generator generator-fix evaluator evaluator-fix judge reporter; do grep -q "$role" "$DOC"; done
for field in sprint_dir base_repo branch base_sha; do grep -q "$field" "$DOC"; done
grep -q 'run.*failed' "$DOC" && grep -q 'session.*closed' "$DOC" && grep -q 'task.*cancelled' "$DOC"
git diff --name-only 88929fa377f5bed3cd1876a575c366ff1b93c0d5 -- | grep -Ev '^(docs/current/ATTEMPT_RUN_BRIDGE_GUIDE.md|[^/]+/.*(test|spec).*|sprints/)' | test ! -s /dev/stdin
```

## journey_type: autonomous
## journey_type_reason: 仅新增仓库使用说明文档，不涉及 UI、远端 agent 协议或 Engine 开发流水线行为。
## target_environment: mac_web
## target_environment_reason: task payload 显式指定 mac_web；验收在 us-mac-m4 仓库工作区执行文档字面与变更范围检查。
## journey_id: none
## step_id: none（PrepPRD 未锚定）
