# Sprint PRD — attempt-run 桥接使用说明

task_request_hash: aecb99079a0f3f82a833c6ff55d42e5903af6050d73033b574511db5dfd00e4f

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：补齐 attempt-run 桥接的可操作说明，降低错误派发风险

## Golden Path（核心场景）

宿主或远端调用方从阅读 `docs/current/` 下的《attempt-run 桥接使用说明》进入，依次确认端点用途与鉴权、九项角色白名单、payload 字段规则及失败回滚结果，最终能够按文档正确发起运行并查询状态。

具体：
1. 读者看到 `POST /api/brain/harness/attempt-run` 用于发起运行，`GET /api/brain/harness/attempt-run/:id` 用于按 id 查询运行状态。
2. 读者看到鉴权名 `internalAuthOrLoopback`，并明确宿主或远端请求必须携带 `Bearer CECELIA_TOKEN`；回环请求按该鉴权规则处理。
3. 读者看到完整且不重复的九项角色白名单。
4. 读者看到 payload 必填 `sprint_dir`、`base_repo`、`branch`，以及 `base_sha` 可省略并由生产 Brain 自解析。
5. 读者看到派发失败时状态依次收敛为 `run→failed`、`session→closed`、`task→cancelled`。

## 边界情况

- 文档不得把 `base_sha` 写成调用方必填字段。
- 文档不得暗示宿主或远端请求可以省略 Bearer 凭据。
- 九项角色白名单必须完整、无重复；角色名称以当前服务合同为准。
- 回滚说明必须同时覆盖 run、session、task 三类对象及其终态。

## 范围限定

**在范围内**：仅在 `docs/current/` 新增一页中文《attempt-run 桥接使用说明》，覆盖端点、鉴权、九项角色白名单、payload 字段和派发失败自动回滚四节。

**不在范围内**：不修改任何代码、路由、鉴权策略、角色集合、数据模型、运行时行为或既有文档。

## 假设

- [ASSUMPTION: 新文档文件名采用 `docs/current/attempt-run-bridge.md`；标题必须为《attempt-run 桥接使用说明》。]
- [ASSUMPTION: 九项角色的权威名称由交付者从当前服务合同逐字转录，PRD 不新增或改名角色。]
- [ASSUMPTION: Unified Map 未配置，因为 task payload 缺少可用的 `map_scope` 与 `map_repo`。]

## 预期受影响文件

- `docs/current/attempt-run-bridge.md`：新增中文 attempt-run 桥接使用说明；这是唯一允许变更的交付文件。

## 可测试验收断言

1. `[ARTIFACT]` `docs/current/attempt-run-bridge.md` 存在，且 git diff 中除该文件外没有其他变更。
2. `[BEHAVIOR]` 文档包含四个独立章节：端点与鉴权、角色白名单、payload 字段、派发失败自动回滚。
3. `[BEHAVIOR]` 文档同时包含 `POST /api/brain/harness/attempt-run`、`GET /api/brain/harness/attempt-run/:id`、`internalAuthOrLoopback` 和 `Bearer CECELIA_TOKEN`。
4. `[BEHAVIOR]` 角色白名单章节恰好列出九个不重复角色。
5. `[BEHAVIOR]` payload 章节将 `sprint_dir`、`base_repo`、`branch` 标为必填，并说明 `base_sha` 可省略且由生产 Brain 自解析。
6. `[BEHAVIOR]` 回滚章节同时包含 `run→failed`、`session→closed`、`task→cancelled`。
7. `[BEHAVIOR]` 文档正文含中文字符，且未把凭据真实值写入仓库。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 待定（PrepPRD 未指定）
- 可观测: 文档必须清楚描述派发失败后三类对象的最终状态

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；仅列与本 sprint 直接适用的约束 -->
- [凭据隔离] 宿主或远端操作必须使用对应主体的授权凭据，不得提交真实 Token（来源: area）
- [基线恒定] 实现基线固定为 `63f921907c86694cad903bf56215980d35edf78a`，不得以角色 checkout 基线替换（来源: task contract）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

- （本 line 暂无历史）

## E2E 验收

```bash
set -euo pipefail
DOC=docs/current/attempt-run-bridge.md
test -f "$DOC"
grep -q 'POST /api/brain/harness/attempt-run' "$DOC"
grep -q 'GET /api/brain/harness/attempt-run/:id' "$DOC"
grep -q 'internalAuthOrLoopback' "$DOC"
grep -q 'Bearer CECELIA_TOKEN' "$DOC"
grep -q 'sprint_dir' "$DOC" && grep -q 'base_repo' "$DOC" && grep -q 'branch' "$DOC" && grep -q 'base_sha' "$DOC"
grep -q 'run→failed' "$DOC" && grep -q 'session→closed' "$DOC" && grep -q 'task→cancelled' "$DOC"
grep -qP '[\x{4e00}-\x{9fff}]' "$DOC"
test "$(git diff --name-only 63f921907c86694cad903bf56215980d35edf78a...HEAD | grep -v '^docs/current/attempt-run-bridge.md$' | wc -l)" -eq 0
```

## journey_type: autonomous
## journey_type_reason: 交付物是 Cecelia 仓库内部接口的使用文档，不包含用户界面或远端 agent 协议变更。
## target_environment: local_api
## target_environment_reason: 文档结构与内容可在本地仓库机械验收，无需连接生产服务。
## journey_id: none
## step_id: none（PrepPRD 未锚定）
