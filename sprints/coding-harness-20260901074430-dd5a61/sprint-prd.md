# Sprint PRD — attempt-run 桥接使用说明

task_request_hash: 5cf49ea74f582ad47e0a8399cdc43cdb56fc753240eaf701ecfcb81e8b07b7f2

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：补齐 attempt-run 桥接的可操作说明与失败语义

## 背景

为宿主机与远端调用方提供一页中文权威入口，说明如何创建、查询 attempt-run，以及派发失败时系统如何收口关联状态。

## Golden Path（核心场景）

宿主或远端操作者从 `docs/current/` 下《attempt-run 桥接使用说明》进入 → 按鉴权与 payload 约束调用桥接端点 → 查询 attempt 状态或确认派发失败后的自动回滚结果。

具体：
1. 文档分别说明 `POST /api/brain/harness/attempt-run` 的创建用途与 `GET /api/brain/harness/attempt-run/:id` 的查询用途。
2. 文档说明两端点均采用 `internalAuthOrLoopback`；宿主或远端请求必须携带 `Bearer CECELIA_INTERNAL_TOKEN`。
3. 文档以九个独立条目完整列出角色白名单，不增不减。
4. 文档说明 payload 必填 `sprint_dir`、`base_repo`、`branch`；`base_sha` 可省略并由生产 Brain 自解析。
5. 文档说明派发失败自动回滚为 `run→failed`、`session→closed`、`task→cancelled`。
6. 读者可仅凭该页区分创建、查询、鉴权、请求字段与失败收口行为。

## 边界情况

- 不把 loopback 可访问误写成宿主或远端免鉴权；宿主或远端始终要求 Bearer token。
- 不把 `base_sha` 写成必填，也不承诺由调用方推导；省略时由生产 Brain 自解析。
- 派发失败必须同时写清 run、session、task 三个对象各自的终态。
- 九项角色名称的精确拼写以现有 attempt-run 端点白名单为准，文档不得创造别名。

## 范围限定

**在范围内**：在 `docs/current/` 新增一页中文 Markdown 使用说明，覆盖两个端点、鉴权、九项角色白名单、payload 字段和失败自动回滚。

**不在范围内**：修改任何代码、路由、鉴权策略、角色集合、数据模型或运行时行为；扩展 attempt-run 能力。

## 假设

- [ASSUMPTION: 现有端点实现中的九项角色白名单是名称与拼写的权威来源；PrepPRD 仅规定数量，未提供九个值。]
- [ASSUMPTION: 文档文件名采用 `docs/current/attempt-run-bridge-guide.md`，标题使用《attempt-run 桥接使用说明》。]
- [ASSUMPTION: 这是文档补全，不涉及 Golden Path journey/step 数据锚定。]

## 预期受影响文件

- `docs/current/attempt-run-bridge-guide.md`：新增中文 attempt-run 桥接使用说明。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 待定（PrepPRD 未指定）
- 可观测: 文档必须明确派发失败后三类关联对象的终态。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；以下为与本次文档合同直接相关的活跃 area 铁律 -->
- [Planner 分支] Planner 必须停留在服务端签发的 planner_branch，不得自行切换分支（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth，无鉴权端点不准 ship（来源: area）
- [禁止环境假设] 环境假设值不得写死，须从环境推导或真实校准（来源: area）
- [真实验证] 依赖真实调用方的接缝断言须在目标环境验证后才算完成（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

- （本 line 暂无历史）

## E2E 验收

```bash
set -euo pipefail
DOC=docs/current/attempt-run-bridge-guide.md
BASE_SHA=5599211397c88c3827d5ce4e9c6061b3802b4fc5
SPRINT_PRD=sprints/coding-harness-20260901074430-dd5a61/sprint-prd.md

test -f "$DOC"
grep -q 'POST /api/brain/harness/attempt-run' "$DOC"
grep -q 'GET /api/brain/harness/attempt-run/:id' "$DOC"
grep -q 'internalAuthOrLoopback' "$DOC"
grep -q 'Bearer CECELIA_INTERNAL_TOKEN' "$DOC"
grep -q '角色白名单' "$DOC"
ROLE_COUNT=$(awk '/^## .*角色白名单/{on=1; next} on && /^## /{on=0} on && /^- `[^`][^`]*`/{n++} END{print n+0}' "$DOC")
test "$ROLE_COUNT" -eq 9
grep -q 'sprint_dir' "$DOC"
grep -q 'base_repo' "$DOC"
grep -q 'branch' "$DOC"
grep -q 'base_sha' "$DOC"
grep -Eq 'base_sha.*(可省略|非必填)' "$DOC"
grep -Eq '生产 Brain.*(自解析|解析)' "$DOC"
grep -q 'run.*failed' "$DOC"
grep -q 'session.*closed' "$DOC"
grep -q 'task.*cancelled' "$DOC"

CHANGED=$(git diff --name-only "$BASE_SHA"...HEAD | grep -v "^$SPRINT_PRD$" || true)
test "$CHANGED" = "$DOC"
grep -qP '[\x{4e00}-\x{9fff}]' "$DOC"
```

## journey_type: autonomous
## journey_type_reason: 交付物是 Cecelia 仓库内部 API 使用文档，不含用户界面或远端 agent 协议变更。
## target_environment: mac_web
## target_environment_reason: task.payload 显式指定 mac_web；验收在该 checkout 中以 shell 检查中文 Markdown 产物。
## journey_id: none
## step_id: none（PrepPRD 未锚定）
