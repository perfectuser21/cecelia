# Sprint PRD — attempt-run 桥接使用说明

## OKR 对齐

- **对应 KR**：未配置（Brain context 未返回活跃 KR）
- **当前进度**：未配置
- **本次推进预期**：交付一页可核验的中文使用说明

## 背景

宿主与远端调用方需要一份统一的 attempt-run 桥接契约，避免鉴权、角色、payload 与派发失败状态回滚被误用。

## Golden Path（核心场景）

维护者从 `docs/current/` 的《attempt-run 桥接使用说明》入口，依次查到 `POST /api/brain/harness/attempt-run` 与 `GET /api/brain/harness/attempt-run/:id` 的用途和调用约束，确认请求可被正确派发，并能解释派发失败后的最终状态。

具体：
1. 读者识别 POST 用于创建/派发 attempt-run，GET 用于按 id 查询 attempt-run 状态。
2. 读者确认鉴权为 `internalAuthOrLoopback`；宿主或远端请求必须携带 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN`。
3. 读者查到生产白名单的九个角色，并确认提交角色属于该集合。
4. 读者确认 payload 必填 `sprint_dir`、`base_repo`、`branch`；`base_sha` 可省略并由生产 Brain 自解析。
5. 派发失败时，读者可观察并核对 `run→failed`、`session→closed`、`task→cancelled`。

## 边界情况

- 非 loopback 且缺少或携带错误 Bearer token 时，不应被文档描述为可调用。
- 文档不得把 `base_sha` 写成调用方必填字段。
- 派发失败不得遗漏 run、session、task 中任一最终状态。

## 范围限定

**在范围内**：仅在 `docs/current/` 新增一页中文文档，包含端点用途、鉴权、九项角色白名单、payload 字段及失败回滚四节。

**不在范围内**：任何代码、测试、配置、API 行为或数据库 schema 变更；桥接实现改造；新增角色。

## 假设

- [ASSUMPTION: 九项角色的具体枚举以实现基线 `5c12d2af68e2b2e4b8dcaaa2c87e50efab743291` 中生产 Brain 白名单 SSOT 为准；任务证据仅给出数量，未给出九个枚举值，文档必须逐项抄录 SSOT，不得猜测。]
- [ASSUMPTION: 新文档文件名可由实现者选择，但必须直接位于 `docs/current/`。]

## 预期受影响文件

- `docs/current/<attempt-run-usage>.md`：新增《attempt-run 桥接使用说明》；不得修改其他文件。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 语言：简体中文。
- 准确性：鉴权名、环境变量、端点、字段名、角色枚举和失败状态必须逐字可核验。
- 变更边界：只新增文档，不改代码。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant；与本 sprint 直接相关的 area 级约束 -->
- [凭据隔离] 宿主/远端调用只说明 Bearer `CECELIA_INTERNAL_TOKEN` 的使用方式，不写入真实凭据（来源: area）
- [基线不漂移] 角色枚举与接口契约必须对照 implementation baseline `5c12d2af68e2b2e4b8dcaaa2c87e50efab743291`（来源: task contract）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

- （本 line 暂无历史）

## E2E 验收

```bash
set -euo pipefail
doc=$(find docs/current -maxdepth 1 -type f -name '*.md' -print0 | xargs -0 grep -l 'attempt-run 桥接使用说明' | head -n1)
test -n "$doc"
grep -q 'POST /api/brain/harness/attempt-run' "$doc"
grep -q 'GET /api/brain/harness/attempt-run/:id' "$doc"
grep -q 'internalAuthOrLoopback' "$doc"
grep -q 'Bearer.*CECELIA_INTERNAL_TOKEN' "$doc"
grep -q 'sprint_dir' "$doc" && grep -q 'base_repo' "$doc" && grep -q 'branch' "$doc"
grep -q 'base_sha.*可省略' "$doc"
grep -q 'run.*failed' "$doc" && grep -q 'session.*closed' "$doc" && grep -q 'task.*cancelled' "$doc"
# 角色白名单章节须逐项列出且恰好九项；每项还须与 implementation baseline 的生产 SSOT 一致。
awk '/^## .*角色白名单/{on=1; next} /^## /{on=0} on && /^- `[^`]+`/{n++} END{exit n==9?0:1}' "$doc"
git diff --name-only 5c12d2af68e2b2e4b8dcaaa2c87e50efab743291...HEAD | awk 'BEGIN{ok=1} !/^docs\/current\/[^/]+\.md$/{ok=0} END{exit ok?0:1}'
```

## journey_type: autonomous
## journey_type_reason: 仅交付后端桥接 API 的使用文档，不涉及 UI 或远端 agent 协议实现。
## target_environment: mac_web
## target_environment_reason: task payload 显式指定 mac_web；验收在仓库工作区执行文档与 git diff 检查。
## journey_id: none
## step_id: none（PrepPRD 未锚定）
