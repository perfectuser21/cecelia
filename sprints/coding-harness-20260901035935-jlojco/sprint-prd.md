# Sprint PRD — attempt-run 桥接使用说明

task_request_hash: c924fc0993e2c65b62e0f01b222ece3c65b6f0090c735a5e33a77291188e36c0

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：补齐 attempt-run 桥接的可操作文档入口，不调整运行时能力

## 背景

当前 attempt-run 桥接需要一页中文使用说明，使宿主与远端调用方能按统一入口发起角色 Attempt、查询结果，并理解鉴权、输入合同及派发失败后的状态回滚。

## Golden Path（核心场景）

调用方从 `docs/current/` 的《attempt-run 桥接使用说明》入口 → 确认 `POST /api/brain/harness/attempt-run` 的发起用途与 `GET /api/brain/harness/attempt-run/:id` 的查询用途 → 按 `internalAuthOrLoopback` 规则鉴权 → 从九项角色白名单选择角色并提交必填 payload → 查询 Attempt 状态或识别派发失败后的自动回滚出口。

具体：
1. 读者能区分 POST 发起端点与 GET 按 id 查询端点，并确认宿主/远端请求必须携带 `Bearer CECELIA_INTERNAL_TOKEN`。
2. 读者能看到完整且恰好九项的角色白名单，以及 payload 必填字段 `sprint_dir`、`base_repo`、`branch`；文档明确 `base_sha` 可省略并由生产 Brain 自解析。
3. 读者能确认派发失败时状态依次收口为 `run→failed`、`session→closed`、`task→cancelled`。

## 边界情况

- 非 loopback 且没有有效 Bearer token 的调用不应被文档描述为可访问。
- `base_sha` 不得误写成调用方必填；其省略语义必须明确限定为生产 Brain 自解析。
- 白名单必须恰好九项，不能以“等角色”省略，也不能把白名单外角色写成可派发。
- 文档仅说明现有合同，不承诺新端点、新状态或新回滚行为。

## 范围限定

**在范围内**：在 `docs/current/` 新增一页中文《attempt-run 桥接使用说明》，覆盖两个端点用途、鉴权、九项角色白名单、payload 字段合同和派发失败自动回滚。

**不在范围内**：修改任何代码、端点行为、鉴权策略、数据库结构、角色集合或运行时配置。

## 假设

- [ASSUMPTION: 九项角色的精确名称以当前生产 Brain 的 attempt-run 白名单为准，文档必须逐项抄录且验收时机械计数为九项。]
- [ASSUMPTION: Unified Map 未配置，因为 task payload 缺少有效的 `map_scope`/`map_repo` 映射；本 sprint 按冻结 thin_prd 的 `docs/current/` 范围锚定。]

## 预期受影响文件

- `docs/current/attempt-run-bridge-guide.md`：新增中文《attempt-run 桥接使用说明》；这是唯一允许的交付文件。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 待定（PrepPRD 未指定）
- 可观测: 文档必须明确 GET 按 id 查询 Attempt 状态以及派发失败的三段收口状态

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；列出与本 documentation-only sprint 直接适用的 area 铁律 -->
- [端点鉴权] 每个 API 端点必须有 auth；无鉴权端点不准 ship（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [Planner分支] Planner workspace 必须保持服务端签发的 planner_branch，不得自行切换分支（来源: area）
- [禁止写死环境] 环境假设值不得写死，应由环境推导或真实环境校准（来源: area）
- [真环境验收] 依赖真实调用方的接缝断言必须在目标环境验证后才算完成（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

- （本 line 暂无历史）

## E2E 验收

```bash
set -eu
DOC=docs/current/attempt-run-bridge-guide.md
test -f "$DOC"
grep -q 'POST /api/brain/harness/attempt-run' "$DOC"
grep -q 'GET /api/brain/harness/attempt-run/:id' "$DOC"
grep -q 'internalAuthOrLoopback' "$DOC"
grep -q 'Bearer CECELIA_INTERNAL_TOKEN' "$DOC"
for field in sprint_dir base_repo branch base_sha; do grep -q "$field" "$DOC"; done
grep -qE 'base_sha.*(可省略|无需提供|非必填).*生产 Brain.*(自解析|解析)' "$DOC"
grep -q 'run.*failed' "$DOC"
grep -q 'session.*closed' "$DOC"
grep -q 'task.*cancelled' "$DOC"
test "$(git diff --name-only 46221f91778af50e1be078f1e542ec5c17360126...HEAD | wc -l | tr -d ' ')" = 1
test "$(git diff --name-only 46221f91778af50e1be078f1e542ec5c17360126...HEAD)" = "$DOC"
test "$(grep -cE '^([0-9]+\.|[-*]) +`?[a-z][a-z-]*`?([：:].*)?$' "$DOC")" = 9
```

验收出口：上述命令全部退出 0；文档存在、为中文、四个必需章节内容可机械检索、角色列表恰好九项，且相对权威实现基线 `46221f91778af50e1be078f1e542ec5c17360126` 只有该文档发生变化。

## journey_type: autonomous
## journey_type_reason: 交付物是 Cecelia 内部 Harness API 的 documentation-only 使用说明，不包含 UI 或远端 Agent 协议变更
## target_environment: mac_web
## target_environment_reason: task payload 显式指定 mac_web；最终文档在 Cecelia 仓库环境执行文件与内容验收
## journey_id: none
## step_id: none(docs)
