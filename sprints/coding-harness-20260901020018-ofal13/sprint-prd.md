# Sprint PRD — attempt-run 桥接使用说明文档

task_request_hash: ebfef97f8a26ba0c1d1a4880794ecb57f95fbdafc91c08b7e7d47f9f27426f46

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：以可核验的桥接使用说明补齐 attempt-run 对接入口，不虚构百分比增量。

## 背景

宿主或远端调用方需要一页中文说明，准确使用 attempt-run 桥接端点，并在派发失败时理解系统自动回滚后的最终状态。本 sprint 只新增 `docs/current/` 文档，不改变端点或运行行为。

## Golden Path（核心场景）

调用方从阅读 `docs/current/` 下《attempt-run 桥接使用说明》进入 → 按文档完成鉴权与 payload 组装并提交 `POST /api/brain/harness/attempt-run` → 使用返回标识查询 `GET /api/brain/harness/attempt-run/:id` → 到达可判断派发进度或失败回滚状态的出口。

具体：
1. 文档分别说明 POST 端点用于创建/派发 attempt-run，GET 端点用于按 id 查询。
2. 文档说明两端点采用 `internalAuthOrLoopback`；宿主或远端请求必须携带 `Bearer CECELIA_INTERNAL_TOKEN`。
3. 文档完整列出角色白名单九项，不合并、不省略，并列明 payload 必填字段 `sprint_dir`、`base_repo`、`branch`。
4. 文档明确 `base_sha` 可省略，省略时由生产 Brain 自解析。
5. 文档明确派发失败会自动回滚为 `run→failed`、`session→closed`、`task→cancelled`，调用方可据此识别失败收口。

## 边界情况

- 区分 loopback 与宿主/远端请求，不能让读者误以为远端可免鉴权。
- 区分 payload 必填字段与可省略的 `base_sha`，不得把后者写成必填。
- 失败回滚的三个对象及状态必须成组出现，不得只描述部分状态。

## 范围限定

**在范围内**：在 `docs/current/` 新增一页中文 attempt-run 桥接使用说明，包含端点用途与鉴权、角色白名单九项、payload 字段规则、派发失败自动回滚四节。

**不在范围内**：修改任何代码、接口、鉴权策略、角色白名单、payload 结构、回滚行为；新增其他文档或调整既有文档。

## 假设

- [ASSUMPTION: 文档中的九项角色名称以 implementation baseline `18cc9dae0611554b6f38ae0239c591449a259229` 已有 attempt-run 端点合同为准；不得新增、改名或猜测。]
- [ASSUMPTION: 本任务未提供 journey_id 与 step_id，按未锚定处理。]
- [ASSUMPTION: task payload 未配置有效的 map_scope/map_repo，Unified Map 状态记为 not_configured，不据此猜测结构。]

## 预期受影响文件

- `docs/current/attempt-run-bridge-guide.md`: 新增《attempt-run 桥接使用说明》中文文档。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 以 implementation baseline `18cc9dae0611554b6f38ae0239c591449a259229` 的端点合同为准
- 可观测: 文档必须让调用方区分运行、会话、任务三个失败收口状态

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；以下为与本 sprint 合同直接相交的 area 铁律 -->
- [角色分支] Planner workspace 必须保持服务端签发的 planner_branch，不得切换分支（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [日志脱敏] 客户隐私、PII、聊天内容不得明文进入日志（来源: area）
- [端点鉴权] 每个 API 端点必须有鉴权，无鉴权端点不得交付（来源: area）
- [环境假设] 环境假设值不得写死，须从环境推导或在真实环境校准（来源: area）
- [真环境验证] 依赖真实环境或调用方的接缝断言须在目标环境验证后才算完成（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

（本 line 暂无历史）

## E2E 验收

```bash
DOC=docs/current/attempt-run-bridge-guide.md
test -f "$DOC"
grep -q 'POST /api/brain/harness/attempt-run' "$DOC"
grep -q 'GET /api/brain/harness/attempt-run/:id' "$DOC"
grep -q 'internalAuthOrLoopback' "$DOC"
grep -q 'Bearer CECELIA_INTERNAL_TOKEN' "$DOC"
grep -qE 'sprint_dir.*base_repo.*branch|branch.*base_repo.*sprint_dir' "$DOC"
grep -q 'base_sha' "$DOC"
grep -qE 'run.*failed.*session.*closed.*task.*cancelled' "$DOC"
test "$(git diff --name-only 18cc9dae0611554b6f38ae0239c591449a259229...HEAD | grep -vc '^docs/current/')" -eq 0
echo "attempt-run 桥接使用说明验收通过"
```

除上述机械检查外，验收者须确认文档有四个清晰章节、角色白名单恰为九项、全文为中文，且相对 implementation baseline 不含代码变更。

## journey_type: autonomous
## journey_type_reason: 交付物是 Cecelia 纯后端桥接 API 的使用说明，不涉及 UI 或远端 agent 协议变更。
## target_environment: local_api
## target_environment_reason: 文档合同锚定 Cecelia Brain API，验收在本地仓库与 local_api 语境完成。
## journey_id: none
## step_id: none（PrepPRD 未锚定）
