# Sprint PRD — attempt-run 桥接使用说明

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：补齐 attempt-run 桥接的运维使用契约，降低错误调用风险

## 背景

为宿主与远端调用方提供一页可核验的中文说明，明确 attempt-run 两步共享 run 的调用边界、鉴权、角色与失败回滚语义。

## Golden Path（核心场景）

宿主或远端调用方从阅读 `docs/current/` 下《attempt-run 桥接使用说明》进入 → 按说明鉴权并通过 `POST /api/brain/harness/attempt-run` 发起 run → 使用返回的 id 调用 `GET /api/brain/harness/attempt-run/:id` 查询同一 run → 能据文档判断成功状态或派发失败后的回滚结果。

具体：
1. 文档分别说明 `POST /api/brain/harness/attempt-run` 与 `GET /api/brain/harness/attempt-run/:id` 的用途。
2. 文档说明鉴权为 `internalAuthOrLoopback`，且宿主/远端请求必须携带 `Bearer CECELIA_INTERNAL_TOKEN`。
3. 文档列出生产契约允许的九项角色白名单，并明确请求 payload 必填 `sprint_dir`、`base_repo`、`branch`。
4. 文档说明 `base_sha` 可省略并由生产 Brain 自解析；派发失败时状态依次收敛为 `run→failed`、`session→closed`、`task→cancelled`。

## 边界情况

- 不把 loopback 可通过的条件误写成宿主/远端免鉴权。
- 不把 `base_sha` 写成调用方必填字段。
- 两个端点必须描述为创建与查询同一 attempt-run 流程，不得混成独立 run。
- 派发失败必须同时说明 run、session、task 三类对象的最终状态。

## 范围限定

**在范围内**：仅在 `docs/current/` 新增一页中文说明，包含端点用途、鉴权、九项角色白名单、payload 字段与失败自动回滚四节。

**不在范围内**：不修改代码、测试、API 行为、鉴权策略、角色白名单或数据库结构；不新增其他文档。

## 假设

- [ASSUMPTION: 九项角色的名称以生产 Brain 当前角色白名单 SSOT 为准；本任务证据只规定数量，未提供九个名称。]
- [ASSUMPTION: 新文档文件名采用清晰表达 attempt-run 主题的英文 kebab-case 名称。]

## 预期受影响文件

- `docs/current/attempt-run-bridge-guide.md`: 新增《attempt-run 桥接使用说明》；这是唯一允许变更的文件。

## NFR 约束

<!-- 来源: PrepPRD 主源；decisions category=nfr 两源均为空 -->
- 语言：简体中文。
- 一致性：端点、鉴权标识、令牌名、字段名及回滚状态必须保持字面精确。
- 可维护性：九项角色名称必须来自生产 Brain 当前白名单，不凭空新增或删减。
- 其他性能/频控/版本要求：不适用（纯文档变更）。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant；step/feature 为空，area 按本 sprint 适用范围筛选并按 id 去重 -->
- [规划分支] Planner workspace 必须保持服务端签发的 planner_branch，Provider 只校验而不切换分支（来源: area）
- [合同枚举] 合同涉及枚举硬编码时必须核对同类检查点，避免遗漏契约项（来源: area）

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
grep -q 'Bearer CECELIA_INTERNAL_TOKEN' "$DOC"
grep -q 'sprint_dir' "$DOC" && grep -q 'base_repo' "$DOC" && grep -q 'branch' "$DOC" && grep -q 'base_sha' "$DOC"
grep -q 'run.*failed' "$DOC" && grep -q 'session.*closed' "$DOC" && grep -q 'task.*cancelled' "$DOC"
test "$(git diff --name-only 3c865b0f86c5f3d95bbebf6cb2d73928b565919b...HEAD | sed '/^$/d' | wc -l | tr -d ' ')" -eq 1
test "$(git diff --name-only 3c865b0f86c5f3d95bbebf6cb2d73928b565919b...HEAD)" = "$DOC"
# Proposer 需补充机械断言：角色白名单章节恰含九项，且集合与生产 Brain SSOT 完全一致。
```

## journey_type: autonomous
## journey_type_reason: 仅新增 Cecelia 内部 Harness API 使用文档，无用户界面或远端 agent 协议变更。
## target_environment: mac_web
## target_environment_reason: task payload 显式指定 mac_web；验收在 Cecelia 仓库工作区执行文档与 git diff 检查。
## journey_id: none
## step_id: none（PrepPRD 未锚定）
