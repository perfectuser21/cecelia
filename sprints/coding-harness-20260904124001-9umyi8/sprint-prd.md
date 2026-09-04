# Sprint PRD — attempt-run 桥接使用说明

task_request_hash: 1a98d5e52361a204cc916cf6c355472e3df09f691436777e1e4697bbbbb935e1

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：补齐 attempt-run 桥接的可操作说明，降低错误调用与故障处置歧义

## 背景

宿主或远端调用方需要一页中文说明，准确使用 attempt-run 桥接的创建与查询端点，并理解鉴权、角色、payload 以及派发失败后的自动回滚结果。Unified Map 未配置（task.payload.map_scope/map_repo 缺少有效映射），本 PRD 仅按冻结 thin_prd 锚定范围。

## Golden Path（核心场景）

调用方从 `docs/current/` 打开《attempt-run 桥接使用说明》→ 按说明创建并查询 attempt run → 能据返回状态判断成功或自动回滚结果。

具体：
1. 文档分别说明 `POST /api/brain/harness/attempt-run` 用于创建派发、`GET /api/brain/harness/attempt-run/:id` 用于按 id 查询状态。
2. 文档说明两端点采用 `internalAuthOrLoopback`；宿主/远端请求必须携带 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN`，且不展示真实凭据。
3. 文档逐项列出九个允许角色，读者可直接判断输入角色是否合法。
4. 文档明确 payload 必填 `sprint_dir`、`base_repo`、`branch`；`base_sha` 可省略并由生产 Brain 自解析。
5. 文档明确派发失败时可观察到 `run→failed`、`session→closed`、`task→cancelled` 三项自动回滚结果。
6. 读者按文档示例能够构造 POST 请求并用返回 id 构造 GET 请求；示例不要求实际访问外部服务。

## 边界情况

- 非 loopback 的宿主/远端请求缺少或使用错误 Bearer token 时，文档不得暗示其可成功调用。
- 不在九项白名单内的角色不得被示例或正文描述为可接受。
- `base_sha` 仅是可省略字段，不能被误写为必填或由客户端随意猜测。
- 派发失败不是部分成功；文档必须同时给出 run、session、task 三个终态。

## 范围限定

**在范围内**：在 `docs/current/` 新增一页中文 Markdown 使用说明，覆盖两个端点用途、鉴权、九项角色白名单、payload 字段和失败回滚，并提供可读调用示例。

**不在范围内**：修改任何代码、端点行为、鉴权实现、数据库结构、配置、测试框架或其他文档。

## 假设

- [ASSUMPTION: 新文档的文件名可由实现者在 `docs/current/` 内选取语义清晰的 Markdown 名称。]
- [ASSUMPTION: 九项角色名称以实现基线 `2721277993f33d00b8a4c2d94fdec5b1ac4f7f32` 中生产接口接受的白名单为准，文档必须逐字列全，不凭记忆补写。]
- [ASSUMPTION: 文档示例中的 token 仅使用环境变量占位，不包含真实值。]

## 预期受影响文件

- `docs/current/<attempt-run-桥接说明>.md`：唯一新增产物，承载完整中文使用说明。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 文档描述须以实现基线 `2721277993f33d00b8a4c2d94fdec5b1ac4f7f32` 为准
- 可观测: 派发失败须完整说明 run、session、task 三个终态

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；以下为与本纯文档范围有约束关系的活跃 area 铁律 -->
- [分支权威] Planner 必须停留在服务端签发的 planner_branch，不得自行切换分支（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth；无鉴权端点不准 ship（来源: area）
- [禁止环境假设] 环境假设值不得写死，须从环境推导或真实校准（来源: area）
- [真验才算完成] 依赖真实环境或调用方的接缝断言须在目标环境验证后才算完成（来源: area）
- [合同命令真跑] 合同中的验证命令须实际运行并确认 exit code 语义（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

（本 line 暂无历史）

## E2E 验收

```bash
set -euo pipefail
BASE_SHA=2721277993f33d00b8a4c2d94fdec5b1ac4f7f32
DOC=$(git diff --name-only --diff-filter=A "$BASE_SHA"...HEAD -- 'docs/current/*.md')
[ "$(printf '%s\n' "$DOC" | sed '/^$/d' | wc -l | tr -d ' ')" -eq 1 ]
test -f "$DOC"
git diff --quiet "$BASE_SHA"...HEAD -- ':!docs/current/*.md'
grep -q 'POST /api/brain/harness/attempt-run' "$DOC"
grep -q 'GET /api/brain/harness/attempt-run/:id' "$DOC"
grep -q 'internalAuthOrLoopback' "$DOC"
grep -q 'Bearer.*CECELIA_INTERNAL_TOKEN' "$DOC"
for field in sprint_dir base_repo branch base_sha; do grep -q "$field" "$DOC"; done
grep -qE 'run.{0,12}failed' "$DOC"
grep -qE 'session.{0,12}closed' "$DOC"
grep -qE 'task.{0,12}cancelled' "$DOC"
[ "$(grep -oE 'planner|proposer|contract-reviewer|generator|evaluator|judge|reporter|generator-fix|evaluator-fix' "$DOC" | sort -u | wc -l | tr -d ' ')" -eq 9 ]
grep -q '[一-龥]' "$DOC"
```

期望：命令退出码为 0；仅新增一份 `docs/current/` 中文文档，且四类必需内容和九项角色均可由机械断言覆盖。

## journey_type: autonomous
## journey_type_reason: 产物是 Cecelia 仓库内部后端接口的使用说明，不含用户界面或远端 agent 协议变更。
## target_environment: mac_web
## target_environment_reason: task payload 显式指定 mac_web；文档验收在 Cecelia 所在 Mac 工作区执行静态断言。
## journey_id: none
## step_id: none（PrepPRD 未锚定）
