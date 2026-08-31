# Sprint PRD — attempt-run 桥接使用说明

task_request_hash: 39b0a0f94749881801b0c265603754f2f3cb4e036c5d8b32559adf713ba351d1

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：补齐 attempt-run 桥接的可操作文档与验收依据

## 背景

attempt-run 桥接已有生产接口，但缺少集中说明。本 sprint 在 `docs/current/` 新增中文文档，明确调用、鉴权、角色、payload 与派发失败回滚语义，降低宿主和远端接入歧义。

## Golden Path（核心场景）

接入者从阅读《attempt-run 桥接使用说明》→ 按约束创建并查询 attempt-run → 能正确理解失败后的状态收口。

具体：
1. 文档分别说明 `POST /api/brain/harness/attempt-run` 的创建用途与 `GET /api/brain/harness/attempt-run/:id` 的查询用途。
2. 文档说明两端点使用 `internalAuthOrLoopback`；宿主或远端请求必须携带 `Bearer CECELIA_INTERNAL_TOKEN`，且不得展示真实令牌。
3. 文档独立列出生产系统允许的九项角色白名单，名称与生产实现逐项一致，不多不少。
4. 文档说明 payload 必填 `sprint_dir`、`base_repo`、`branch`；`base_sha` 可省略并由生产 Brain 自解析。
5. 文档说明派发失败时自动回滚为 `run→failed`、`session→closed`、`task→cancelled`。

## 边界情况

- 明确区分 loopback 与宿主/远端鉴权要求，避免把本机特例推广到远端。
- `base_sha` 仅为可省略字段，不得误写成必填或由调用方固定提供。
- 回滚三组状态必须同时出现，不能只描述其中一部分。

## 范围限定

**在范围内**：新增 `docs/current/` 下的一页中文说明文档，覆盖两个端点、鉴权、九项角色白名单、payload 字段和派发失败回滚。

**不在范围内**：修改端点、鉴权、角色白名单、状态机或任何代码；新增 API 行为；记录真实 token。

## 假设

- [ASSUMPTION: 九项角色名称以生产 Brain 当前白名单为事实源，文档必须逐项照录。]
- [ASSUMPTION: 本任务未绑定 Journey/Step，使用 none 作为锚点。]

## 预期受影响文件

- `docs/current/attempt-run-bridge.md`：新增《attempt-run 桥接使用说明》中文文档。

## NFR 约束

- 超时/延迟：待定（PrepPRD 未指定）
- 频控：待定（PrepPRD 未指定）
- 版本要求：以生产 Brain 当前接口与角色白名单为准
- 可观测：文档不得包含真实凭据；回滚状态须可逐项核对

## Invariant 约束（铁律，proposer/evaluator 不得违反）

- [端点鉴权] 每个 API 端点必须有 auth；无鉴权端点不准 ship（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [日志脱敏] 客户隐私、PII、聊天内容不得明文进日志（来源: area）
- [禁止环境假设] 环境假设值不得写死，应从环境推导或在真实环境校准（来源: area）
- [真环境验收] 接缝断言必须在目标环境验证后才算 done（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

- （本 line 暂无历史）

## E2E 验收

```bash
set -euo pipefail
DOC="docs/current/attempt-run-bridge.md"
test -f "$DOC"
grep -q 'POST /api/brain/harness/attempt-run' "$DOC"
grep -q 'GET /api/brain/harness/attempt-run/:id' "$DOC"
grep -q 'internalAuthOrLoopback' "$DOC"
grep -q 'Bearer CECELIA_INTERNAL_TOKEN' "$DOC"
grep -q 'sprint_dir' "$DOC" && grep -q 'base_repo' "$DOC" && grep -q 'branch' "$DOC"
grep -q 'base_sha' "$DOC" && grep -qE '可省略|非必填' "$DOC"
grep -q 'run.*failed' "$DOC" && grep -q 'session.*closed' "$DOC" && grep -q 'task.*cancelled' "$DOC"
test "$(grep -cE '^[-*] `?[a-z][a-z-]*`?' "$DOC")" -eq 9
test "$(git diff --name-only 5c12d2af68e2b2e4b8dcaaa2c87e50efab743291...HEAD -- ':(exclude)docs/current/**' | wc -l | tr -d ' ')" -eq 0
```

## journey_type: autonomous
## journey_type_reason: 交付物是 Cecelia 后端桥接接口的说明文档，不包含用户界面或远端 Agent 行为变更。
## target_environment: mac_web
## target_environment_reason: task payload 显式指定 mac_web；在 Cecelia 宿主工作区核对文档与生产接口事实。
## journey_id: none
## step_id: none（PrepPRD 未锚定）
