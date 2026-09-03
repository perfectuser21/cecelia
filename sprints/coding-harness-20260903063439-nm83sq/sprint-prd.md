# Sprint PRD — attempt-run 桥接使用说明

task_request_hash: 64de302ba99ea7e35a528afdc12dbeaa8eede8d1076c32f7fef385b0504b9709

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：补齐 attempt-run 桥接的可操作说明与验收依据

## 背景

为宿主与远端调用方提供统一的 attempt-run 桥接说明，降低端点用途、鉴权、派发参数和失败回滚状态的误用风险。

## Golden Path（核心场景）

调用方从阅读 `docs/current/` 下《attempt-run 桥接使用说明》进入，完成鉴权与请求准备，使用 `POST /api/brain/harness/attempt-run` 发起派发，再使用 `GET /api/brain/harness/attempt-run/:id` 查询结果，并能依据文档识别派发失败后的完整回滚状态。

具体：
1. 文档分别说明 POST 创建/派发 attempt-run 与 GET 按 id 查询 attempt-run 的用途。
2. 文档说明两端点均使用 `internalAuthOrLoopback`；宿主或远端请求必须携带 `Authorization: Bearer <CECELIA_INTERNAL_TOKEN>`，且不得暴露真实令牌。
3. 文档逐项列出生产端点允许的九项角色白名单，不使用“等”省略成员。
4. 文档说明 payload 必填 `sprint_dir`、`base_repo`、`branch`；`base_sha` 可省略并由生产 Brain 自行解析。
5. 文档说明派发失败时自动回滚为 `run → failed`、`session → closed`、`task → cancelled`。

## 边界情况

- 区分 loopback 访问与宿主/远端访问，避免把 loopback 免附加 Bearer 的条件扩展到远端。
- `base_sha` 省略仅表示由生产 Brain 解析，不应被描述为必填或由调用方猜测。
- 失败回滚必须同时覆盖 run、session、task 三个实体及其目标状态。

## 范围限定

**在范围内**：仅新增 `docs/current/` 下的一页中文说明文档，覆盖端点用途、鉴权、九项角色白名单、payload 字段和失败回滚。

**不在范围内**：不修改任何代码、接口行为、配置、测试或既有文档；不执行真实 attempt-run 派发。

## 假设

- [ASSUMPTION: 九项角色的精确名称以生产端点当前白名单为准，成文时必须逐项抄录并由验收对照生产定义，禁止凭记忆补写。]
- [ASSUMPTION: 文档文件名可由实现者选择清晰的 kebab-case 名称，但必须直接位于 `docs/current/`。]

## 预期受影响文件

- `docs/current/attempt-run-bridge-guide.md`：新增《attempt-run 桥接使用说明》；唯一允许的交付文件。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 语言：简体中文。
- 安全：示例不得包含真实 `CECELIA_INTERNAL_TOKEN` 值。
- 一致性：端点、字段名与状态枚举必须逐字准确。
- 可观测：读者可从 GET 端点查询指定 attempt-run 的状态。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；以下列出与本次文档交付直接相关的有效铁律 -->
- [分支归属] Planner 必须停留在服务端签发的 planner_branch，不得自行切换分支（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth，无鉴权端点不准 ship（来源: area）
- [真相核对] 环境与接口约束不得凭假设写死，应以生产定义为准（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

- （本 line 暂无历史）

## E2E 验收

```bash
set -euo pipefail
DOC=docs/current/attempt-run-bridge-guide.md
test -f "$DOC"
grep -q 'POST /api/brain/harness/attempt-run' "$DOC"
grep -q 'GET /api/brain/harness/attempt-run/:id' "$DOC"
grep -q 'internalAuthOrLoopback' "$DOC"
grep -q 'Bearer.*CECELIA_INTERNAL_TOKEN' "$DOC"
grep -q 'sprint_dir' "$DOC" && grep -q 'base_repo' "$DOC" && grep -q 'branch' "$DOC" && grep -q 'base_sha' "$DOC"
grep -qE 'run.{0,20}failed' "$DOC" && grep -qE 'session.{0,20}closed' "$DOC" && grep -qE 'task.{0,20}cancelled' "$DOC"
git diff --name-only 863590823193364151bd4aae610f68aaaa42e200...HEAD | grep -q '^docs/current/attempt-run-bridge-guide.md$'
test "$(git diff --name-only 863590823193364151bd4aae610f68aaaa42e200...HEAD | wc -l | tr -d ' ')" = 1
# 角色白名单的精确九项由 proposer 从生产定义固化为九条逐项断言，且必须验证无“等”字省略。
```

## journey_type: dev_pipeline
## journey_type_reason: 文档服务于 Harness attempt-run 派发与查询开发流程，且不改变产品 UI 或 API 行为。
## target_environment: mac_web
## target_environment_reason: task payload 显式指定 mac_web；交付物为仓库内中文文档，可在当前 mac_web 工作区验收。
## journey_id: none
## step_id: none（PrepPRD 未锚定）
